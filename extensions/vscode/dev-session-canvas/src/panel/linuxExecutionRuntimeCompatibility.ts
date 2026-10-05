import { spawnSync } from 'node:child_process';
import { assertMinimumExecutionLibraryVersion } from './executionAssetCompatibility';

let runtimeGlibcVersion: string | undefined;

const glibcProbe = `
  const report = process.report;
  if (report) { report.excludeNetwork = true; report.excludeEnv = true; }
  process.stdout.write(JSON.stringify(report?.getReport()?.header?.glibcVersionRuntime ?? null));
`;

export function readLinuxRuntimeGlibcVersion(): string {
  if (runtimeGlibcVersion !== undefined) return runtimeGlibcVersion;
  let version: unknown;
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: unknown } } | undefined;
    version = report?.header?.glibcVersionRuntime;
  } catch {
    // Other extensions can replace or disable process.report in the shared Host.
  }
  if (version === undefined || version === null) {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    delete env.VSCODE_INSPECTOR_OPTIONS;
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    try {
      const result = spawnSync(process.execPath, ['-e', glibcProbe], {
        env, encoding: 'utf8', shell: false, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (result.error || result.status !== 0 || result.signal !== null) throw new Error('Probe failed.');
      version = JSON.parse(result.stdout);
    } catch {
      throw new Error('Cannot determine the Linux runtime glibc version from the execution host.');
    }
  }
  try {
    assertMinimumExecutionLibraryVersion(version, version);
  } catch {
    throw new Error('Invalid or unavailable Linux runtime glibc version.');
  }
  // The loaded libc is stable for this process; do not probe again per session.
  runtimeGlibcVersion = version as string;
  return runtimeGlibcVersion;
}
