const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

// This fixture models only the read-only scope probe, not a native user manager.
// The original launcher produces the response; the caller still validates it.
function main() {
  const args = process.argv.slice(2);
  const [executable, launcher, probeFlag, nonce] = args.slice(13);
  assert.match(nonce ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.ok(executable && path.isAbsolute(executable) && !executable.includes('\0'));
  assert.ok(launcher && path.isAbsolute(launcher) && !launcher.includes('\0'));
  assert.deepEqual(args, [
    '--user', '--wait', '--pipe', '--collect', '--quiet', '--no-ask-password',
    `--unit=dsc-root-scope-${nonce}`,
    '--property=TimeoutStartSec=10s', '--property=RuntimeMaxSec=10s',
    '--property=TimeoutStopSec=2s', '--property=KillMode=control-group',
    '--setenv=ELECTRON_RUN_AS_NODE=1', '--setenv=ELECTRON_NO_ATTACH_CONSOLE=1',
    executable, launcher, '--probe-root-environment', nonce
  ]);
  const child = spawn(executable, [launcher, probeFlag, nonce], {
    stdio: 'inherit', shell: false,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
  });
  // Finish inside the caller's 15-second budget, including child shutdown.
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 12_000);
  const terminate = () => child.kill('SIGKILL');
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    clearTimeout(watchdog);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', terminate);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
