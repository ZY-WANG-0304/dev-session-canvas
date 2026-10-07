import { assertExecutionIdentity } from '../common/executionLifecycle';
import { MACOS_EXECUTION_NATIVE_EXPORTS, resolveMacosExecutionProviderAssets } from './macosExecutionOwnerFactory';
import { runUnixExecutionProvider, type LinuxInteractiveExecutionBinding } from './linuxExecutionProvider';

async function main(): Promise<void> {
  if (typeof process.send !== 'function' || !process.connected || process.argv.length !== 8) {
    throw new Error('The macOS execution provider requires its original authority IPC launch.');
  }
  const identity = { executionId: process.argv[2], generation: process.argv[3] };
  assertExecutionIdentity(identity);
  const assets = resolveMacosExecutionProviderAssets(__dirname);
  if (assets.binarySha256 !== process.argv[4] || assets.manifestSha256 !== process.argv[5] ||
      assets.entrySha256 !== process.argv[6] || assets.helperSha256 !== process.argv[7]) {
    throw new Error('macOS candidate assets changed before provider startup.');
  }
  const binding: unknown = require(assets.binaryPath);
  if (!binding || typeof binding !== 'object' ||
      JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(MACOS_EXECUTION_NATIVE_EXPORTS) ||
      MACOS_EXECUTION_NATIVE_EXPORTS.some(name => typeof (binding as Record<string, unknown>)[name] !== 'function')) {
    throw new Error('macOS execution provider loaded incompatible native exports.');
  }
  const result = await runUnixExecutionProvider({ identity, binding: binding as LinuxInteractiveExecutionBinding,
    platform: 'darwin', helperPath: assets.helperPath, cols: 80, rows: 24, pollIntervalMs: 5, interactionV1: true });
  if (result.kind !== 'closed') {
    process.stderr.write(`${result.reason ?? 'macOS execution provider did not settle its original resources.'}\n`);
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
