import { assertExecutionIdentity } from '../common/executionLifecycle';
import { WINDOWS_EXECUTION_NATIVE_EXPORTS, resolveWindowsExecutionProviderAssets } from './windowsExecutionOwnerFactory';
import { runWindowsExecutionProvider, type WindowsExecutionBinding } from './windowsExecutionProvider';
import { resolveExecutionSessionSpawnSpec } from './executionSessionBridge';

async function main(): Promise<void> {
  if (process.platform !== 'win32' || typeof process.send !== 'function' || !process.connected || process.argv.length !== 8) {
    throw new Error('The Windows execution provider requires its original authority IPC launch.');
  }
  const identity = { executionId: process.argv[2], generation: process.argv[3] };
  assertExecutionIdentity(identity);
  const assets = resolveWindowsExecutionProviderAssets(__dirname);
  if (assets.binarySha256 !== process.argv[4] || assets.manifestSha256 !== process.argv[5]
    || assets.entrySha256 !== process.argv[6] || assets.workerSha256 !== process.argv[7]) {
    throw new Error('Windows candidate assets changed before provider startup.');
  }
  const binding: unknown = require(assets.binaryPath);
  if (!binding || typeof binding !== 'object'
    || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(WINDOWS_EXECUTION_NATIVE_EXPORTS)
    || WINDOWS_EXECUTION_NATIVE_EXPORTS.some(name => typeof (binding as Record<string, unknown>)[name] !== 'function')) {
    throw new Error('Windows execution provider loaded incompatible native exports.');
  }
  const { argsToCommandLine } = require('node-pty/lib/windowsPtyAgent') as {
    argsToCommandLine(file: string, args: readonly string[] | string): string;
  };
  const result = await runWindowsExecutionProvider({ identity, binding: binding as WindowsExecutionBinding,
    workerPath: assets.workerPath, commandLine(file, args, env) {
      const resolved = resolveExecutionSessionSpawnSpec({ file, args, env }, 'win32');
      return argsToCommandLine(resolved.file, resolved.args);
    } });
  if (result.kind !== 'closed') {
    process.stderr.write(`${result.reason ?? 'Windows execution provider did not settle its original resources.'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
