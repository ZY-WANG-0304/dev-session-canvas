import { createHash } from 'crypto';
import * as path from 'path';

import type { RuntimeSupervisorPaths } from './runtimeSupervisorProtocol';

export function resolveRuntimeSupervisorPaths(storageDir: string): RuntimeSupervisorPaths {
  return resolveRuntimeSupervisorPathsFromRoot(path.join(storageDir, 'runtime-supervisor'));
}

export function resolveRuntimeSupervisorPathsFromRoot(rootDir: string): RuntimeSupervisorPaths {
  return {
    rootDir,
    socketPath: resolveRuntimeSupervisorSocketPath(rootDir),
    registryPath: path.join(rootDir, 'registry.json')
  };
}

function resolveRuntimeSupervisorSocketPath(rootDir: string): string {
  if (process.platform === 'win32') {
    const digest = createHash('sha1').update(rootDir).digest('hex').slice(0, 24);
    return `\\\\.\\pipe\\dev-session-canvas-${digest}`;
  }

  return path.join(rootDir, 'supervisor.sock');
}
