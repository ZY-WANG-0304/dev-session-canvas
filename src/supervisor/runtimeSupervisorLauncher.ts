import { spawn } from 'child_process';
import * as path from 'path';

async function main(): Promise<void> {
  const supervisorScriptPath = readCliPathFlag('--supervisor-script');
  const storageDir = readCliPathFlag('--storage-dir');
  if (!supervisorScriptPath) {
    throw new Error('runtime supervisor launcher 启动失败：缺少 --supervisor-script 参数。');
  }

  if (!storageDir) {
    throw new Error('runtime supervisor launcher 启动失败：缺少 --storage-dir 参数。');
  }

  const args = [supervisorScriptPath, '--storage-dir', storageDir];
  const socketPath = readCliPathFlag('--socket-path');
  if (socketPath) {
    args.push('--socket-path', socketPath);
  }

  const runtimeDir = readCliPathFlag('--runtime-dir');
  if (runtimeDir) {
    args.push('--runtime-dir', runtimeDir);
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

function readCliFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const value = process.argv[index + 1];
  return value?.trim() || undefined;
}

function readCliPathFlag(name: string): string | undefined {
  const value = readCliFlag(name);
  return value ? path.resolve(value) : undefined;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
