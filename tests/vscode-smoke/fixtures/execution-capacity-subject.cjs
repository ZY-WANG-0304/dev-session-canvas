const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const blocks = [640, 1280, 2560];
const row = index => `${String(index).padStart(8, '0')}:${'x'.repeat(69)}`;
const block = index => `${row(index)}\r\n`.repeat(128);
const titleControl = nonce => `\x1b]2;${nonce}\x07\x1b]0;\x07`;
const sourcePrefix = (_nonce, scenario) => `\x1b[2J\x1b[H${scenario === 'color' ? '\x1b]10;rgb:12/34/56\x07' : ''}`;
const prefix = (nonce, scenario) => titleControl(nonce) + sourcePrefix(nonce, scenario);
const capacityWorkload = sessionCount => {
  assert([2, 10].includes(sessionCount), 'Only the fixed two/ten-session workloads are defined.');
  return { sessionCount, rssGrowthSafetyBytes: (sessionCount === 10 ? 6 : 2) * 1024 ** 3,
    observationBudgets: sessionCount === 10 ? {
      supervisorRss: 1280 * 1024 ** 2, hostRss: 640 * 1024 ** 2,
      rendererGroupRss: 1536 * 1024 ** 2, providersRss: 1024 * 1024 ** 2,
      subjectsRss: 768 * 1024 ** 2, totalRss: 5 * 1024 ** 3, hostHeapUsed: 192 * 1024 ** 2
    } : undefined };
};
module.exports = { blocks, row, block, titleControl, sourcePrefix, prefix, capacityWorkload };

if (require.main === module) {
  if (process.argv[2] === '--check-format') {
    for (const count of blocks) {
      const digest = createHash('sha256');
      for (let index = 1; index <= count; index += 1) {
        const value = block(index);
        assert.equal(Buffer.byteLength(value), 10240);
        digest.update(value);
      }
      console.log(JSON.stringify({ blocks: count, bytes: count * 10240, sha256: digest.digest('hex') }));
    }
  } else {
    run().catch(error => { console.error(error); process.exitCode = 1; process.stdin.destroy(); });
  }
}

async function run() {
  const [role, scenario, receiptPath, offlineTriggerPath] = process.argv.slice(2);
  assert(['a', 'b'].includes(role));
  assert(['color', 'size', 'compact'].includes(scenario));
  assert(receiptPath && process.stdin.isTTY && process.stdout.isTTY, 'Requires a real raw PTY.');
  if (offlineTriggerPath) assert(role === 'a' && scenario === 'color', 'Offline input is only defined for color subject A.');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  const nonce = `DSC_A1_BEGIN_${process.pid}_${Date.now()}`;
  const digest = createHash('sha256');
  let bytesWritten = 0;
  let produced = 0;
  let pending = '';
  let chain = Promise.resolve();
  let triggerTimer;
  const save = state => {
    fs.writeFileSync(`${receiptPath}.tmp`, `${JSON.stringify({ role, scenario, pid: process.pid,
      nonce, blocks: produced, bytesWritten, sha256: digest.copy().digest('hex'), ...state })}\n`);
    fs.renameSync(`${receiptPath}.tmp`, receiptPath);
  };
  const write = (data, count = true) => new Promise((resolve, reject) => process.stdout.write(data, error => {
    if (error) return reject(error);
    if (role === 'a' && count) { digest.update(data); bytesWritten += Buffer.byteLength(data); }
    resolve();
  }));
  const safety = setTimeout(() => { save({ state: 'safety-timeout' }); process.exit(2); }, 600000);
  safety.unref();
  const produce = async target => {
    assert.equal(target, blocks[blocks.indexOf(produced) + 1]);
    while (produced < target) {
      await write(block(produced + 1));
      produced += 1;
    }
    save({ state: 'stage-complete' });
  };
  const enqueue = action => {
    chain = chain.then(action).catch(error => {
      clearInterval(triggerTimer);
      clearTimeout(safety);
      save({ state: 'error', error: String(error) });
      process.exit(1);
    });
  };
  if (role === 'a') {
    await write(titleControl(nonce), false);
    await write(sourcePrefix(nonce, scenario));
  } else await write('DSC_A1_B_READY\r\n');
  save({ state: 'ready' });
  if (offlineTriggerPath) {
    // The outer runner publishes this file only after the original Host exits.
    triggerTimer = setInterval(() => {
      let text;
      try { text = fs.readFileSync(offlineTriggerPath, 'utf8'); }
      catch (error) {
        if (error.code === 'ENOENT') return;
        clearInterval(triggerTimer);
        enqueue(() => { throw error; });
        return;
      }
      clearInterval(triggerTimer);
      enqueue(async () => {
        assert.deepEqual(JSON.parse(text), { blocks: 2560 });
        for (const target of blocks) await produce(target);
      });
    }, 100);
    triggerTimer.unref();
  }
  process.stdin.on('data', data => {
    pending += data;
    assert(pending.length < 1024, 'Bounded fixture commands only.');
    let end;
    while ((end = pending.search(/[\r\n]/)) >= 0) {
      const input = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!input) continue;
      enqueue(async () => {
        if (input === 'current-state-marker' && role === 'a') {
          await write('DSC_RELOAD_CURRENT_STATE_MARKER\\r\\n', false);
          return;
        }
        if (input === 'finish') {
          save({ state: 'finished' });
          clearInterval(triggerTimer);
          clearTimeout(safety);
          process.stdin.destroy();
          return;
        }
        if (input.startsWith('ping:') && (role === 'b' || (role === 'a' && scenario === 'compact'))) {
          assert.match(input, /^ping:[a-zA-Z0-9_-]{1,80}$/);
          await write(`DSC_A1_REPLY_${input.slice(5)}\r\n`, role === 'a' && scenario === 'compact' ? false : true);
          return;
        }
        if (input.startsWith('noise:') && role === 'a' && scenario === 'compact') {
          const blocks = Number(input.slice(6));
          assert(Number.isSafeInteger(blocks) && blocks > 0 && blocks <= 4096);
          // Keep the noise in the same unwrapped row shape as the primary
          // workload so checkpoint semantic validation measures compaction,
          // not a giant-line wrap edge case.
          const chunk = block(0);
          for (let index = 0; index < blocks; index += 1) await write(chunk, false);
          await write(`DSC_A1_COMPACT_NOISE_DONE_${blocks}\r\n`, false);
          return;
        }
        assert.match(input, /^produce:\d+$/);
        await produce(Number(input.slice(8)));
      });
    }
  });
}
