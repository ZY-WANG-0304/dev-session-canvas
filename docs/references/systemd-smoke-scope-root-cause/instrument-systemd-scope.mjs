import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const files = [
  'extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootPreparation.ts',
  'extensions/vscode/dev-session-canvas/src/panel/runtimeSystemdEnvironment.ts'
];
const originalHashes = {};
for (const file of files) {
  const original = await fs.readFile(file, 'utf8');
  originalHashes[file] = createHash('sha256').update(original).digest('hex');
  await fs.writeFile(`${file}.systemd-rca-original`, original, { flag: 'wx' });
  let source = `import { appendFileSync as appendSystemdRcaTrace, existsSync as systemdRcaExists } from 'node:fs';
function systemdRcaTrace(record: Record<string, unknown>): void {
  try { appendSystemdRcaTrace(process.env.DSC_SYSTEMD_RCA_TRACE_FILE!, JSON.stringify({ file: ${JSON.stringify(file)}, ...record }) + '\\n', { mode: 0o600 }); } catch {}
}
` + original;
  const replaceOnce = (needle, replacement) => {
    assert.equal(source.split(needle).length, 2, `Cannot identify unique instrumentation point in ${file}`);
    source = source.replace(needle, replacement);
  };
  if (file.includes('runtimeRootPreparation')) {
    replaceOnce('catch { return { kind: \'rejected\', reason: \'Invalid root runtime preparation request.\' }; }',
      'catch { return { kind: \'rejected\', reason: \'Invalid root runtime preparation request.\' }; }\n  systemdRcaTrace({kind: \'request\', preferredBackends: request.preferredBackends});');
    replaceOnce("    if (discovered.kind !== 'absent') return discovered;",
      "    systemdRcaTrace({kind: 'discovered-before-selection', result: discovered});\n    if (discovered.kind !== 'absent') return discovered;");
    replaceOnce("        if (scope.kind === 'unknown')", "        systemdRcaTrace({kind: 'scope-result', result: scope});\n        if (scope.kind === 'unknown')");
    replaceOnce("    const intent = createRuntimeRootStartupIntent(request.owner, selected,",
      "    systemdRcaTrace({kind: 'selected', backend: selected});\n    const intent = createRuntimeRootStartupIntent(request.owner, selected,");
  } else {
    if (process.env.DSC_SYSTEMD_RCA_PROBE_CONTROL === 'local-launcher') {
      // Diagnostic causal control: execute the original read-only launcher, retaining response validation.
      replaceOnce("execFile('/usr/bin/systemd-run', [", "execFile(process.execPath, [");
      const probeStart = source.indexOf('    execFile(process.execPath, [');
      const argumentEnd = source.indexOf('    ], {', probeStart);
      assert(probeStart >= 0 && argumentEnd > probeStart);
      source = source.slice(0, probeStart) + `    execFile(process.execPath, [
      options.supervisorLauncherScriptPath, '--probe-root-environment', nonce
` + source.slice(argumentEnd);
      replaceOnce("env: { ...process.env, LC_ALL: 'C', LANG: 'C' }",
        "env: { ...process.env, LC_ALL: 'C', LANG: 'C', ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }");
    }
    replaceOnce("  const nonce = randomUUID();", `  const nonce = randomUUID();
  systemdRcaTrace({kind: 'probe-environment', dbus: !process.env.DBUS_SESSION_BUS_ADDRESS ? 'unset-or-empty'
    : process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:' ? 'disabled' : 'set',
    probeExecutor: process.env.DSC_SYSTEMD_RCA_PROBE_CONTROL === 'local-launcher' ? 'diagnostic-local-launcher' : 'real-systemd-run',
    runtimeDirSet: Boolean(process.env.XDG_RUNTIME_DIR),
    runtimeBusSocketExists: Boolean(process.env.XDG_RUNTIME_DIR && systemdRcaExists(path.join(process.env.XDG_RUNTIME_DIR, 'bus'))),
    systemctlShimSet: Boolean(process.env.DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM)});`);
    replaceOnce("    }, (error, stdout, stderr) => {", `    }, (error, stdout, stderr) => {
      let parsedProbe: Record<string, unknown> | undefined;
      try { parsedProbe = JSON.parse(stdout); } catch {}
      const knownBusErrors = ['No medium found', 'No such file or directory', 'Connection refused'];
      systemdRcaTrace({kind: 'probe-callback', code: error?.code ?? 0, killed: Boolean(error?.killed), signal: error?.signal ?? null,
        stderrCategory: !stderr.trim() ? 'empty'
          : stderr.includes('$DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined') ? 'user-bus-address-missing'
          : knownBusErrors.find(value => stderr.startsWith('Failed to connect to bus: ' + value)) ?? 'other',
        stdoutJson: Boolean(parsedProbe), schemaMatches: parsedProbe?.schema === 1, nonceMatches: parsedProbe?.nonce === nonce,
        environmentMatches: parsedProbe?.environmentKey === options.environmentKey,
        userMatches: parsedProbe?.userIdentityKey === options.userIdentityKey});`);
  }
  await fs.writeFile(file, source);
}
console.log(JSON.stringify({ diagnostic_only: true, input: '08f7b0a52f5af27ced04b00a839f525a92659d63', originalHashes,
  mutations: process.env.DSC_SYSTEMD_RCA_PROBE_CONTROL === 'local-launcher'
    ? 'Diagnostic local child executes the original read-only launcher instead of systemd-run; original response validation, selection, budgets and assertions unchanged.'
    : 'Finite observations only; original probe, results, selection, budgets and assertions unchanged.' }));
