// 只验证原脚本的编排与环境传递；所有子进程被记录器替代，不执行发布验收。
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
const root = process.cwd();
const source = await readFile('scripts/release/release-preflight.mjs', 'utf8');
const cases = [];
for (const filter of [undefined, 'trusted']) {
  const env = { PATH: '/audit/recorder', ...(filter ? { DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER: filter } : {}) };
  const calls = [];
  const context = vm.createContext({ process: { env, argv: [], cwd: () => root }, console });
  const modules = {
    child_process: { spawnSync(file, args, options) {
      calls.push({ file, args, effectiveFilter: (options.env ?? env).DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER ?? null });
      return { status: 0 };
    } },
    fs: { existsSync() {}, readFileSync() {} }, path: { default: path }, url: { fileURLToPath: () => '/audit/imported-only.mjs' }
  };
  const module = new vm.SourceTextModule(source + '\nexport { runFullVerification };', { context, identifier: 'file:///audit/release-preflight.mjs' });
  await module.link((name) => {
    const values = modules[name];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  module.namespace.runFullVerification('0.26.1');
  assert.deepEqual(calls.map(c => [...c.args]), [
    ['run', 'test:release-preflight'], ['run', 'test:release-preflight-workflow'],
    ['run', 'test'], ['run', 'validate:clean-checkout:vsix', '--', '--ref', 'HEAD']
  ]);
  assert.ok(calls.every(c => c.effectiveFilter === (filter ?? null)));
  cases.push({ filter: filter ?? null, orchestrationReturnedNormally: true, calls });
}
const smoke = await readFile('scripts/smoke/run-vscode-smoke.mjs', 'utf8');
const vsix = await readFile('scripts/smoke/run-vscode-vsix-smoke.mjs', 'utf8');
const clean = await readFile('scripts/release/run-clean-checkout-vsix-validation.mjs', 'utf8');
const arraySource = smoke.slice(smoke.indexOf('const scenarios = ['), smoke.indexOf('async function main()'));
const parsed = vm.runInNewContext(arraySource + '\nscenarios');
const additional = [...smoke.matchAll(/shouldRunScenario\('([^']+)'\)/g)].map(m => m[1]).filter(s => s !== 'remote-ssh-real-reopen');
additional.push('remote-ssh-real-reopen-exit', 'remote-ssh-real-reopen-retain');
const packaged = vm.runInNewContext(vsix.match(/const scenarios = (\[[^;]+\]);/)[1]);
const sourceDefaults = [...parsed.filter(s => !s.focusedOnly).map(s => s.name), ...additional];
assert.equal(new Set(sourceDefaults).size, 19);
assert.equal(packaged.length, 8);
const isolatedEnvSource = clean.match(/const isolatedEnv = (\{[\s\S]+?\n    \});/)[1];
const inherited = vm.runInNewContext('(' + isolatedEnvSource + ')', {
  process: { env: { DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER: 'trusted' } },
  tempHomeDir: '/audit/home', xdgCacheDir: '/audit/cache', npmCacheDir: '/audit/npm',
  npmUserConfigPath: '/audit/npmrc', vsceDocRef: 'audit-sha', projectRoot: root
});
assert.equal(inherited.DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER, 'trusted');
assert.equal(sourceDefaults.filter(s => s === 'trusted').length, 1);
assert.equal(packaged.filter(s => s === 'trusted').length, 1);
const scripts = JSON.parse(await readFile('package.json', 'utf8')).scripts;
const visited = new Set();
function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  for (const match of (scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g)) visit(match[1]);
}
for (const entry of ['test:release-preflight', 'test:release-preflight-workflow', 'test', 'validate:clean-checkout:vsix', 'package:vsix', 'test:vsix-smoke']) visit(entry);
const candidates = ['typecheck:notifier', 'test:notifier-smoke', 'test:notifier-locale-smoke', 'test:ui-copy-locale-smoke',
  'test:publish-tag-release', 'test:vscode-smoke-runner-env', 'test:runtime-root-ownership', 'test:runtime-root-preparation',
  'test:runtime-supervisor-startup-profile', 'test:runtime-supervisor-namespace', 'test:execution-native-assets'];
const result = {
  scope: '原脚本的受控编排/静态选择检查；子进程记录器，不代表产品测试或完整门禁通过',
  cases, defaultSourceScenarios: sourceDefaults,
  focusedOnly: parsed.filter(s => s.focusedOnly).map(s => s.name), defaultPackagedScenarios: [...packaged],
  filteredTrusted: { source: 1, packaged: 1, cleanCheckoutPreservesFilter: true },
  successMessageSource: source.includes('发布完整验证通过：v${options.version}'),
  topLevelTestCommands: scripts.test.split(' && '), reachableNamedScripts: [...visited].sort(),
  candidateNamedScriptReachability: Object.fromEntries(candidates.map(k => [k, visited.has(k)])),
  limits: 'named script不可达不证明其所有实现路径未覆盖；工作区npm命令及测试脚本内部直接调用需另行核对'
};
await writeFile('docs/references/release-gate-flow-audit/orchestration-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceScenarios: sourceDefaults.length, packagedScenarios: packaged.length, filteredTrusted: result.filteredTrusted, topLevelCommands: result.topLevelTestCommands.length, unreachable: candidates.filter(k => !visited.has(k)) }, null, 2));
