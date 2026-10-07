import { assertExecutionIdentity } from '../common/executionLifecycle';
import { LINUX_EXECUTION_NATIVE_EXPORTS, resolveLinuxExecutionProviderAssets } from './linuxExecutionOwnerFactory';
import { runLinuxExecutionProvider, type LinuxInteractiveExecutionBinding } from './linuxExecutionProvider';

async function main(): Promise<void> {
  if (typeof process.send !== 'function' || !process.connected || process.argv.length !== 7) {
    throw new Error('The Linux execution provider requires its original authority IPC launch.');
  }
  const identity = { executionId: process.argv[2], generation: process.argv[3] };
  assertExecutionIdentity(identity);
  const assets = resolveLinuxExecutionProviderAssets(__dirname);
  if (assets.binarySha256 !== process.argv[4] || assets.manifestSha256 !== process.argv[5] || assets.entrySha256 !== process.argv[6]) {
    throw new Error('Linux candidate assets changed before provider startup.');
  }
  const binding: unknown = require(assets.binaryPath);
  if (!binding || typeof binding !== 'object' ||
    JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(LINUX_EXECUTION_NATIVE_EXPORTS) ||
    LINUX_EXECUTION_NATIVE_EXPORTS.some(name => typeof (binding as Record<string, unknown>)[name] !== 'function')) {
    throw new Error('Linux execution provider loaded incompatible native exports.');
  }
  const result = await runLinuxExecutionProvider({ identity, binding: binding as LinuxInteractiveExecutionBinding,
    cols: 80, rows: 24, pollIntervalMs: 5, interactionV1: true });
  if (result.kind !== 'closed') {
    process.stderr.write(`${result.reason ?? 'Linux execution provider did not settle its original resources.'}\n`);
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
