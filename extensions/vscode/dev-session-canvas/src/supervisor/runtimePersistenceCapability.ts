import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { promisify } from 'node:util';

import { readRuntimeExecutionEnvironment } from '../panel/runtimeExecutionEnvironment';

export interface RuntimePersistenceTarget {
  uid: number;
  user: string;
  host: string;
  environmentKey: string;
}

export type RuntimePersistenceReason = 'unsupported-platform' | 'identity-unavailable' | 'linger-disabled'
  | 'observation-failed' | 'manager-unavailable' | 'environment-mismatch' | 'unit-unverified' | 'supervisor-upgrade-required';

export interface RuntimePersistenceCapability {
  status: 'eligible' | 'blocked' | 'unknown' | 'unsupported';
  reason?: RuntimePersistenceReason;
  target?: RuntimePersistenceTarget;
  managerControlGroup?: string;
}

export interface RuntimePersistenceInspectionDependencies {
  platform: string;
  identify(): Promise<RuntimePersistenceTarget>;
  run(file: string, args: string[]): Promise<string>;
  readFile(filename: string): Promise<string>;
  readlink(filename: string): Promise<string>;
}

const execFileAsync = promisify(execFile);
const NAMESPACES = ['pid', 'mnt', 'user', 'net'] as const;
const UID_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const PROPERTIES = ['Id', 'ActiveState', 'MainPID', 'ControlGroup'];

const defaultDependencies: RuntimePersistenceInspectionDependencies = {
  platform: process.platform,
  async identify() {
    const uid = process.getuid?.();
    if (uid === undefined || uid !== process.geteuid?.()) throw new Error('Invalid runtime user.');
    const environment = await readRuntimeExecutionEnvironment();
    if (environment.userIdentity !== `uid:${uid}`) throw new Error('Runtime user changed.');
    return { uid, user: userInfo().username, host: hostname(), environmentKey: environment.environmentKey };
  },
  async run(file, args) {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: 5000, maxBuffer: 16384, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
    });
    if (stderr.trim()) throw new Error('Unexpected system diagnostics.');
    return stdout;
  },
  readFile: filename => readFile(filename, 'utf8'),
  readlink
};

export function sameRuntimePersistenceTarget(left: RuntimePersistenceTarget, right: RuntimePersistenceTarget): boolean {
  return left.uid === right.uid && left.environmentKey === right.environmentKey && left.host === right.host;
}

export function shouldDeferRuntimePersistenceEnable(requested: boolean, stored: boolean | undefined,
  capability: RuntimePersistenceCapability | undefined): boolean {
  return requested && stored === false && capability !== undefined && capability.status !== 'eligible';
}

export function runtimeLingerCommand(target: RuntimePersistenceTarget, administrator = false, operation: 'enable' | 'disable' = 'enable'): string {
  if (!Number.isSafeInteger(target.uid) || target.uid < 0 || target.uid >= 0xffffffff) {
    throw new Error('Invalid runtime UID.');
  }
  return administrator
    ? `/usr/bin/sudo /usr/bin/loginctl ${operation}-linger ${target.uid}`
    : `/usr/bin/loginctl --no-ask-password ${operation}-linger ${target.uid}`;
}

function properties(output: string, expected: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of output.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    if (separator < 1 || !expected.includes(key) || result.has(key)) throw new Error('Invalid system properties.');
    result.set(key, line.slice(separator + 1));
  }
  if (expected.some(key => !result.has(key))) throw new Error('Missing system properties.');
  return result;
}

async function matchesProcessEnvironment(pid: string, uid: number,
  dependencies: RuntimePersistenceInspectionDependencies): Promise<boolean> {
  if (!/^[1-9][0-9]*$/.test(pid) || Number(pid) > 0x7fffffff) return false;
  const status = await dependencies.readFile(`/proc/${pid}/status`);
  const identities = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
  if (!identities || identities.slice(1).some(value => Number(value) !== uid)) return false;
  const namespaces = await Promise.all(NAMESPACES.map(async name => {
    const expected = await dependencies.readlink(`/proc/self/ns/${name}`);
    return new RegExp(`^${name}:\\[[1-9][0-9]*\\]$`).test(expected)
      && expected === await dependencies.readlink(`/proc/${pid}/ns/${name}`);
  }));
  return namespaces.every(Boolean);
}

export async function inspectRuntimePersistenceCapability(
  dependencies: RuntimePersistenceInspectionDependencies = defaultDependencies
): Promise<RuntimePersistenceCapability> {
  if (dependencies.platform !== 'linux') return { status: 'unsupported', reason: 'unsupported-platform' };
  let target: RuntimePersistenceTarget;
  try {
    target = await dependencies.identify();
    runtimeLingerCommand(target);
    if (!/^[a-f0-9]{64}$/.test(target.environmentKey)) throw new Error('Invalid runtime environment.');
  } catch { return { status: 'unknown', reason: 'identity-unavailable' }; }
  try {
    const user = properties(await dependencies.run('/usr/bin/loginctl', ['--no-ask-password', 'show-user',
      String(target.uid), '--property=UID', '--property=Linger', '--property=Service']), ['UID', 'Linger', 'Service']);
    if (!UID_PATTERN.test(user.get('UID')!) || user.get('UID') !== String(target.uid)
      || !['yes', 'no'].includes(user.get('Linger')!)) throw new Error('Invalid user properties.');
    const service = `user@${target.uid}.service`;
    if (user.get('Service') !== service) return { status: 'blocked', reason: 'manager-unavailable', target };
    const manager = properties(await dependencies.run('/usr/bin/systemctl', ['--no-ask-password', 'show',
      '--no-pager', `--property=${PROPERTIES.join(',')}`, service]), PROPERTIES);
    if (manager.get('Id') !== service || manager.get('ActiveState') !== 'active'
      || manager.get('ControlGroup') !== `/user.slice/user-${target.uid}.slice/${service}`) {
      return { status: 'blocked', reason: 'manager-unavailable', target };
    }
    if (!await matchesProcessEnvironment(manager.get('MainPID')!, target.uid, dependencies)) {
      return { status: 'blocked', reason: 'environment-mismatch', target };
    }
    return { status: user.get('Linger') === 'yes' ? 'eligible' : 'blocked',
      ...(user.get('Linger') === 'no' ? { reason: 'linger-disabled' as const } : {}),
      target, managerControlGroup: manager.get('ControlGroup') };
  } catch { return { status: 'unknown', reason: 'observation-failed', target }; }
}

export async function verifyRuntimePersistenceUnit(
  capability: RuntimePersistenceCapability, unitName: string | undefined, pid: number,
  dependencies: RuntimePersistenceInspectionDependencies = defaultDependencies
): Promise<boolean> {
  if (capability.status !== 'eligible' || !capability.target || !capability.managerControlGroup
    || !unitName || !/^[a-zA-Z0-9_.@-]+\.service$/.test(unitName)
    || !Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) return false;
  try {
    const startTime = async (): Promise<string> => {
      const stat = await dependencies.readFile(`/proc/${pid}/stat`);
      const value = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      if (!/^[0-9]+$/.test(value ?? '')) throw new Error('Invalid process identity.');
      return value;
    };
    const originalStart = await startTime();
    const required = [...PROPERTIES, 'InvocationID', 'PartOf', 'BindsTo', 'RuntimeMaxUSec', 'KillMode'];
    const unit = properties(await dependencies.run('/usr/bin/systemctl', ['--user', '--no-ask-password', 'show',
      '--no-pager', `--property=${required.join(',')}`, unitName]), required);
    const controlGroup = unit.get('ControlGroup')!;
    if (unit.get('Id') !== unitName || unit.get('ActiveState') !== 'active' || unit.get('MainPID') !== String(pid)
      || !controlGroup.startsWith(`${capability.managerControlGroup}/`)
      || !/^[a-f0-9]{32}$/.test(unit.get('InvocationID')!) || unit.get('PartOf') !== '' || unit.get('BindsTo') !== ''
      || unit.get('RuntimeMaxUSec') !== 'infinity' || unit.get('KillMode') !== 'control-group') return false;
    const cgroups = (await dependencies.readFile(`/proc/${pid}/cgroup`)).trim().split('\n');
    if (!cgroups.some(line => /^(?:0::|[0-9]+:name=systemd:)/.test(line)
      && line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1) === controlGroup)) return false;
    return await matchesProcessEnvironment(String(pid), capability.target.uid, dependencies)
      && originalStart === await startTime();
  } catch { return false; }
}
