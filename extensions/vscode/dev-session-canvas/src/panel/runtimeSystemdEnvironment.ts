import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type RuntimeSystemdEnvironmentObservation =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'unknown'; reason: string };

export interface RuntimeSystemdEnvironmentOptions {
  supervisorLauncherScriptPath: string;
  environmentKey: string;
  userIdentityKey: string;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_BUFFER = 16 * 1024;

export async function inspectRuntimeSystemdEnvironment(
  options: RuntimeSystemdEnvironmentOptions
): Promise<RuntimeSystemdEnvironmentObservation> {
  if (process.platform !== 'linux') return { kind: 'unavailable', reason: 'unsupported-platform' };
  if (!path.isAbsolute(options.supervisorLauncherScriptPath) || options.supervisorLauncherScriptPath.includes('\0') ||
    !DIGEST_PATTERN.test(options.environmentKey) || !DIGEST_PATTERN.test(options.userIdentityKey)) {
    return { kind: 'unknown', reason: 'invalid-probe-input' };
  }

  const nonce = randomUUID();
  return new Promise(resolve => {
    execFile('/usr/bin/systemd-run', [
      '--user', '--wait', '--pipe', '--collect', '--quiet', '--no-ask-password',
      `--unit=dsc-root-scope-${nonce}`,
      // Transient job timeout properties vary by manager; these bound service phases, not queue time.
      '--property=TimeoutStartSec=10s', '--property=RuntimeMaxSec=10s',
      '--property=TimeoutStopSec=2s', '--property=KillMode=control-group',
      '--setenv=ELECTRON_RUN_AS_NODE=1', '--setenv=ELECTRON_NO_ATTACH_CONSOLE=1',
      process.execPath, options.supervisorLauncherScriptPath, '--probe-root-environment', nonce
    ], {
      encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER,
      windowsHide: true, env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
    }, (error, stdout, stderr) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ kind: 'unavailable', reason: 'systemd-run-unavailable' });
        } else if (typeof error.code === 'number' && !error.killed && !error.signal &&
          stderr.trim() === 'Failed to connect to bus: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined (consider using --machine=<user>@.host --user to connect to bus of other user)') {
          resolve({ kind: 'unavailable', reason: 'user-bus-address-missing' });
        } else if (typeof error.code === 'number' && !error.killed && !error.signal &&
          /^Failed to connect to bus: (?:No medium found|No such file or directory|Connection refused)(?: \(consider using --machine=<user>@\.host --user to connect to bus of other user\))?$/.test(stderr.trim())) {
          resolve({ kind: 'unavailable', reason: 'user-bus-unavailable' });
        } else {
          resolve({ kind: 'unknown', reason: 'environment-probe-failed' });
        }
        return;
      }
      try {
        if (stderr.trim()) throw new Error('Unexpected probe diagnostics');
        const response: unknown = JSON.parse(stdout);
        if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid probe response');
        const record = response as Record<string, unknown>;
        if (Object.keys(record).length !== 4 || record.schema !== 1 || record.nonce !== nonce ||
          typeof record.environmentKey !== 'string' || !DIGEST_PATTERN.test(record.environmentKey) ||
          typeof record.userIdentityKey !== 'string' || !DIGEST_PATTERN.test(record.userIdentityKey)) {
          throw new Error('Invalid probe identity');
        }
        resolve(record.environmentKey === options.environmentKey && record.userIdentityKey === options.userIdentityKey
          ? { kind: 'available' }
          : { kind: 'unavailable', reason: 'execution-scope-mismatch' });
      } catch {
        resolve({ kind: 'unknown', reason: 'invalid-probe-response' });
      }
    });
  });
}
