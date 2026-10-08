const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const vscode = require('vscode');
const { assertInside, assertRemoteHost, assertRemoteInstalledRuntime } = require('./remote-execution-candidate.cjs');

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function run() {
  const binding = JSON.parse(await fs.readFile(path.resolve(__dirname, '../..', 'remote-control.json'), 'utf8'));
  assert.equal(binding.schemaVersion, 1);
  const controlFile = binding.controlFile;
  assert(controlFile && path.isAbsolute(controlFile), 'An explicit staged driver control file is required.');
  const inheritedControlFile = process.env.DEV_SESSION_CANVAS_REMOTE_CANDIDATE_CONTROL_FILE;
  if (inheritedControlFile !== undefined) assert.equal(inheritedControlFile, controlFile, 'Fixture and staged control bindings must agree.');
  const control = JSON.parse(await fs.readFile(controlFile, 'utf8'));
  assert.equal(control.schemaVersion, 1);
  assert(['probe', 'complete', 'reopen'].includes(control.phase));
  const write = (name, value) => fs.writeFile(path.join(control.artifactsDir, name),
    `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try {
    const executable = await fs.realpath(process.execPath);
    assertInside(control.serverRoot, executable);
    const serverProduct = JSON.parse(await fs.readFile(path.join(path.dirname(executable), 'product.json'), 'utf8'));
    assert.equal(path.basename(serverProduct.serverDataFolderName), serverProduct.serverDataFolderName);
    const serverDataRoot = await fs.realpath(path.join(control.serverRoot, serverProduct.serverDataFolderName));
    assertInside(serverDataRoot, executable);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const executionEnvironment = control.rootOwner
      ? await require('./candidate-root-ownership.cjs').readRuntimeExecutionEnvironment() : undefined;
    const receipt = { schemaVersion: 1, phase: control.phase, mode: control.mode,
      pid: process.pid, remoteName: vscode.env.remoteName, platform: process.platform, arch: process.arch,
      versions: process.versions, glibc: process.report.getReport().header.glibcVersionRuntime,
      executable, executableSha256: await fileHash(executable),
      serverDataRoot, controlTransport: inheritedControlFile === undefined ? 'staged-driver-binding' : 'fixture-setenv-and-driver',
      vscodeVersion: vscode.version, serverCommit: serverProduct.commit,
      workspacePath: folders.length === 1 ? await fs.realpath(folders[0].uri.fsPath) : null,
      workspaces: folders.map(folder => ({ scheme: folder.uri.scheme, authority: folder.uri.authority,
        path: folder.uri.path })),
      ...(executionEnvironment ? { environmentKey: executionEnvironment.environmentKey,
        environmentSample: 'before-product-test' } : {}),
      productPresent: Boolean(vscode.extensions.getExtension('devsessioncanvas.dev-session-canvas')),
      productActive: vscode.extensions.getExtension('devsessioncanvas.dev-session-canvas')?.isActive ?? false };
    // Record the actual API URI; remote hosts may decode vscode-remote into file URIs.
    await write(`${control.phase}-remote-host.json`, receipt);
    assertRemoteHost(receipt, control);
    if (control.phase === 'probe') {
      assert.equal(receipt.productPresent, false, 'The probe must not load or execute the product.');
      return;
    }
    assert(['live-runtime', 'snapshot-only'].includes(control.mode));
    const expected = JSON.parse(await fs.readFile(control.expectationPath, 'utf8'));
    assert.equal(expected.runtimeName, 'node');
    if (control.rootOwner) assert.equal(control.mode, 'live-runtime');
    await assertRemoteInstalledRuntime(process, expected);
    Object.assign(process.env, {
      DEV_SESSION_CANVAS_CANDIDATE_MODE: control.mode,
      DEV_SESSION_CANVAS_CANDIDATE_PHASE: control.phase,
      DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR: control.artifactsDir,
      DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
      DEV_SESSION_CANVAS_INSTALLED_VSIX_EXPECTATION: control.expectationPath,
      DEV_SESSION_CANVAS_ROOT_OWNER_ACCEPTANCE: control.rootOwner ? '1' : '',
      DEV_SESSION_CANVAS_CANDIDATE_SUBJECT_NODE: executable
    });
    await require('./execution-candidate-tests.cjs').run();
  } catch (error) {
    await write(`${control.phase}-remote-failure.json`, { error: String(error), stack: error.stack });
    throw error;
  }
}

module.exports = { run };
