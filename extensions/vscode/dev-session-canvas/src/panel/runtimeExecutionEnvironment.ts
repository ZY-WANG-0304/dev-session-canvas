import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

export interface RuntimeExecutionEnvironment {
  environmentKey: string;
  userIdentity: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BUFFER = 16 * 1024;
const LINUX_NAMESPACE_NAMES = ['pid', 'mnt', 'user', 'net'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The boot UUID comes from the kernel; wall-clock boot times can change after a clock adjustment.
const WINDOWS_PROBE = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RuntimeBootEnvironmentProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct BootEnvironment {
        public Guid BootIdentifier;
        public uint FirmwareType;
        public ulong BootFlags;
    }
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int NtQuerySystemInformation(int informationClass,
        out BootEnvironment information, int informationLength, out int returnLength);
    public static string ReadBootIdentifier() {
        BootEnvironment information;
        int returned;
        int status = NtQuerySystemInformation(90, out information,
            Marshal.SizeOf(typeof(BootEnvironment)), out returned);
        if (status != 0 || returned < 16 || information.BootIdentifier == Guid.Empty)
            throw new InvalidOperationException("Boot environment unavailable");
        return information.BootIdentifier.ToString("D");
    }
}
'@
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $result = [ordered]@{
        bootIdentifier = [RuntimeBootEnvironmentProbe]::ReadBootIdentifier()
        userIdentity = $identity.User.Value
    }
    [Console]::Out.Write(($result | ConvertTo-Json -Compress))
} finally {
    $identity.Dispose()
}
`;

export async function readRuntimeExecutionEnvironment(): Promise<RuntimeExecutionEnvironment> {
  try {
    switch (process.platform) {
      case 'linux': {
        const bootIdentifier = normalizeBootIdentifier(await readFile('/proc/sys/kernel/random/boot_id', 'utf8'));
        const namespaces = await Promise.all(LINUX_NAMESPACE_NAMES.map(async (name) => {
          const value = await readlink(`/proc/self/ns/${name}`);
          if (!new RegExp(`^${name}:\\[[1-9][0-9]*\\]$`).test(value)) {
            throw new Error('Invalid namespace identity');
          }
          return value;
        }));
        return {
          environmentKey: hashEnvironment('linux-boot-namespaces-v1', [bootIdentifier, ...namespaces]),
          userIdentity: readUnixUserIdentity()
        };
      }
      case 'darwin':
        return {
          environmentKey: hashEnvironment('darwin-bootsessionuuid-v1', [
            normalizeBootIdentifier(await runProbe('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']))
          ]),
          userIdentity: readUnixUserIdentity()
        };
      case 'win32': {
        const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
        if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) {
          throw new Error('Windows system directory unavailable');
        }
        const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const output = await runProbe(executable, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(WINDOWS_PROBE, 'utf16le').toString('base64')
        ]);
        const value: unknown = JSON.parse(output);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid Windows environment response');
        }
        const record = value as Record<string, unknown>;
        if (Object.keys(record).length !== 2 || typeof record.bootIdentifier !== 'string'
          || typeof record.userIdentity !== 'string' || !/^S-1-[0-9]+(?:-[0-9]+)+$/.test(record.userIdentity)) {
          throw new Error('Invalid Windows environment response');
        }
        return {
          environmentKey: hashEnvironment('win32-bootidentifier-v1', [normalizeBootIdentifier(record.bootIdentifier)]),
          userIdentity: `sid:${record.userIdentity}`
        };
      }
      default:
        throw new Error('Unsupported platform');
    }
  } catch {
    // Probe errors may contain the command or OS identifiers; never forward their raw payload.
    throw new Error(`Runtime execution environment is unknown (${process.platform}); OS identity probe failed.`);
  }
}

function normalizeBootIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized) || normalized === '00000000-0000-0000-0000-000000000000') {
    throw new Error('Invalid boot identifier');
  }
  return normalized;
}

function readUnixUserIdentity(): string {
  const uid = process.getuid?.();
  if (uid === undefined || !Number.isSafeInteger(uid) || uid < 0) {
    throw new Error('OS user identity unavailable');
  }
  return `uid:${uid}`;
}

function hashEnvironment(sourceVersion: string, values: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([sourceVersion, ...values])).digest('hex');
}

function runProbe(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error || stderr.trim()) {
        reject(new Error('OS identity probe failed'));
        return;
      }
      resolve(stdout);
    });
  });
}
