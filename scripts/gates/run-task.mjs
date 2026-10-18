import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newTaskReceipt, objectDigest, fileDigest, writeJSON } from './receipts.mjs';
import { runProcess } from './process.mjs';

export function assertCheckout(plan, root = process.cwd()) {
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(actual, plan.inputSHA, 'Task checkout differs from the frozen plan');
  execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root});
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'})
    .split('\n').filter(file=>file&&!/^(?:gate-(?:plan|results|input|transfer|actual|native|final|artifacts)|checked-acceptance)\//.test(file)
      &&!/^gate-(?:provenance|native-provenance)\.json$/.test(file));
  assert.deepEqual(untracked,[],'Formal tasks cannot use uncommitted source');
}
export function resultPath(output, task) {
  return path.join(output, task.job, task.variant, `${taskFileName(task.id)}.task.json`);
}
export function taskFileName(id) {
  // Task IDs remain exact in receipts; filenames must also be valid when an
  // artifact is downloaded on NTFS. Encoding is reversible and collision-free.
  return encodeURIComponent(id).replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
export async function executeTask({ plan, task, output, command, env = process.env, consumed = [],
  prepare = async () => {}, action, assertResult, cleanup, signal, deadline, embeddedCleanup = false }) {
  const receipt = newTaskReceipt(plan, task, env);
  const started=Date.now();
  receipt.startedAt = new Date(started).toISOString(); receipt.deadline = deadline ?? started + task.timeoutMs;
  assert(receipt.deadline<=started+task.timeoutMs,'Task deadline cannot be extended');
  const reserves=task.budgets??{workMs:task.timeoutMs-((cleanup?Math.min(60000,task.timeoutMs/4):0)),
    cleanupMs:cleanup?Math.min(60000,task.timeoutMs/4):0,hostExitMs:0,evidenceMs:0};
  const workDeadline=receipt.deadline-reserves.cleanupMs-reserves.hostExitMs-reserves.evidenceMs;
  const hostTask=task.stages.includes('host-exit');
  const ownsCleanup = (Boolean(command) || embeddedCleanup) && task.stages.includes('cleanup');
  const hostProcessDeadline=receipt.deadline-reserves.evidenceMs;
  receipt.budgets=reserves;receipt.workDeadline=workDeadline;
  receipt.consumed = consumed;
  const destination = resultPath(output, task);
  let result;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let unsettled=false;
  const stage = async (name, fn) => {
    if (!task.stages.includes(name)) return;
    const startedAt = new Date().toISOString();
    let timer,settlementTimer;
    const releaseStage=['cleanup','host-exit'].includes(name);
    const stageController=releaseStage?new AbortController():controller;
    const stageDeadline=(hostTask || ownsCleanup)&&['build','action','assert','cleanup'].includes(name)?hostProcessDeadline
      :name==='cleanup'?Math.min(Date.now()+reserves.cleanupMs,receipt.deadline-reserves.hostExitMs-reserves.evidenceMs)
      :name==='host-exit'?Math.min(Date.now()+reserves.hostExitMs,receipt.deadline-reserves.evidenceMs):workDeadline;
    let expiration;
    try {
      const remaining = stageDeadline - Date.now();
      assert(remaining > 0, 'Original task deadline exhausted');
      const operation=Promise.resolve().then(()=>fn(stageDeadline,stageController.signal));
      const observed=operation.then(value=>({value}),error=>({error}));
      const outcome=await Promise.race([observed,new Promise(resolve=>{
        timer=setTimeout(()=>{expiration=new Error(`Original ${name} deadline exhausted`);
          stageController.abort(expiration);resolve({expired:true});},remaining);
      })]);
      let finished=outcome;
      if(outcome.expired) {
        // Never run fixture cleanup while its action process is still retiring.
        // Settlement consumes the original cleanup reserve, not a new task budget.
        const allowance=Math.max(0,Math.min(10000,receipt.deadline-reserves.evidenceMs-Date.now()));
        finished=await Promise.race([observed,new Promise(resolve=>{
          settlementTimer=setTimeout(()=>resolve({unsettled:true}),allowance);
        })]);
        if(finished.unsettled)unsettled=true;
        throw expiration;
      }
      if(finished.error)throw finished.error;
      const value=finished.value;
      receipt.stages[name] = { status: 'passed', startedAt, completedAt: new Date().toISOString(), deadline:stageDeadline,
        ...(value ? { detail: value } : {}) };
      await writeJSON(destination, receipt); return value;
    } catch (error) {
      if (error.unsettled) unsettled = true;
      receipt.stages[name] = { status: !releaseStage&&signal?.aborted ? 'cancelled' : 'failed', startedAt,
        completedAt: new Date().toISOString(), deadline:stageDeadline, reason: error.message };
      receipt.failures.push({ stage: name, reason: error.message }); throw error;
    } finally { clearTimeout(timer);clearTimeout(settlementTimer); }
  };
  try {
    await stage('prepare', prepare);
    if (command) {
      const actionStage = task.stages.includes('build') ? 'build' : task.stages.includes('action') ? 'action' : 'assert';
      result = await stage(actionStage, async (actionDeadline,actionSignal) => {
        const logPath = destination.replace('.task.json', '.log');
        const observed = await runProcess(command.file, command.args, { env: { ...env,
          DEV_SESSION_CANVAS_GATE_DEADLINE: String(hostTask || ownsCleanup ? workDeadline : actionDeadline),
          DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE:String(receipt.deadline-reserves.hostExitMs-reserves.evidenceMs),
          DEV_SESSION_CANVAS_GATE_EXIT_DEADLINE:String(hostProcessDeadline) },
          deadline:actionDeadline,logPath,signal:actionSignal });
        result = observed;
        receipt.evidence.push({ path: path.relative(output, logPath), sha256: await fileDigest(logPath) });
        assert.equal(observed.status, 'passed', `Process ${observed.status}: ${JSON.stringify(observed)}`);
        return observed;
      });
    } else if (action) result = await stage(task.stages.includes('build') ? 'build' : 'action',
      (actionDeadline,actionSignal) => action(ownsCleanup ? workDeadline : actionDeadline,actionSignal));
    if (task.stages.includes('load')) await stage('load', () => assertResult(result, receipt));
    if (receipt.stages.assert?.status !== 'passed') await stage('assert',
      (assertDeadline) => assertResult ? assertResult(result, receipt, 'assert', assertDeadline) : undefined);
  } catch (error) {
    receipt.status = signal?.aborted || result?.cancelled ? 'cancelled' : 'failed';
    if (!receipt.failures.length) receipt.failures.push({ stage: 'action', reason: error.message });
  } finally {
    if (task.stages.includes('cleanup')&&!unsettled) {
      try { await stage('cleanup', async () => {
        assert(cleanup, 'Resource-owning tasks need observed cleanup');
        return cleanup(result, receipt, receipt.deadline-reserves.hostExitMs-reserves.evidenceMs);
      }); } catch { receipt.status = 'failed'; }
    }
    if(unsettled)receipt.failures.push({stage:'cleanup',reason:'Action did not settle before cleanup; concurrent cleanup refused'});
    if(task.stages.includes('host-exit')&&!unsettled) {
      try {assert(assertResult,'Host tasks require independent Host evidence');
        await stage('host-exit',(exitDeadline)=>assertResult(result,receipt,'host-exit',exitDeadline));}
      catch(error){receipt.status='failed';if(!receipt.failures.some(f=>f.reason===error.message))
        receipt.failures.push({stage:'host-exit',reason:error.message});}
    }
    receipt.completedAt = new Date().toISOString();
    if (Date.parse(receipt.completedAt) > receipt.deadline) {
      receipt.failures.push({ stage: 'deadline', reason: 'Task exceeded its original ceiling' }); receipt.status = 'failed';
    }
    if (!receipt.failures.length && Object.values(receipt.stages).every(stage => stage.status === 'passed')) receipt.status = 'passed';
    else if (receipt.status === 'not-run') receipt.status = 'failed';
    await writeJSON(destination, receipt);
    signal?.removeEventListener('abort', cancel);
  }
  return receipt;
}
export async function markNotRun(plan, task, output, reason) {
  const receipt = newTaskReceipt(plan, task); receipt.failures.push({ stage: 'prepare', reason });
  await writeJSON(resultPath(output, task), receipt); return receipt;
}

export async function recordConsumedArtifact(kind, file) {
  return { kind, sha256: await fileDigest(file), file: path.basename(file) };
}
