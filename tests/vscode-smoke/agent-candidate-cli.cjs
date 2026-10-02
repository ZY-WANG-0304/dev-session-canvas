const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const agentCandidateScenarioNames = Object.freeze(['codex', 'claude'].flatMap(provider =>
  ['live-runtime', 'snapshot-only'].flatMap(mode => ['natural', 'stop'].map(lifecycle =>
    `${provider}-${mode}-${lifecycle}`))));

function selectAgentCandidateScenarios(value, { authOnly = false } = {}) {
  assert(value === undefined || typeof value === 'string', 'Scenario selection must be a comma-separated string.');
  assert(!authOnly || value === undefined, 'Auth-only diagnosis cannot select product scenarios.');
  const requested = value === undefined || value === '' ? [...agentCandidateScenarioNames] : value.split(',');
  assert(requested.length > 0 && requested.every(name => agentCandidateScenarioNames.includes(name)),
    'Select only exact names from the fixed eight Agent scenarios.');
  assert.equal(new Set(requested).size, requested.length, 'Do not repeat an Agent scenario.');
  const selectedScenarioNames = authOnly ? [] : agentCandidateScenarioNames.filter(name => requested.includes(name));
  return { selectedScenarioNames, partialSelection: !authOnly && selectedScenarioNames.length !== agentCandidateScenarioNames.length,
    plannedModelTurns: selectedScenarioNames.filter(name => name.endsWith('-natural')).length };
}

function invokeCLI(resolveSpawn, file, args, options = {}, platform = process.platform) {
  const spec = resolveSpawn({ file, args, env: options.env ?? process.env }, platform);
  return spawnSync(spec.file, typeof spec.args === 'string' ? [spec.args] : spec.args,
    { ...options, ...(typeof spec.args === 'string' ? { windowsVerbatimArguments: true } : {}), shell: false });
}

async function findExecutable(name, platform = process.platform, environment = process.env) {
  const paths = Object.entries(environment).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const directory of paths.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const candidate = path.join(directory, platform === 'win32' ? `${name}.cmd` : name);
    try {
      await fs.access(candidate, constants.X_OK);
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  throw new Error(`Required real CLI is missing: ${name}`);
}

async function windowsCliManifest(provider, entry, nodeInterpreter) {
  assert.equal(process.platform, 'win32');
  const packageName = provider === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
  const packageRoot = path.join(path.dirname(entry), 'node_modules', packageName);
  const packagePath = path.join(packageRoot, 'package.json');
  const metadata = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  assert.equal(metadata.name, packageName);
  assert.equal(metadata.version, provider === 'codex' ? '0.157.1' : '2.1.280');
  let nativeExecutable;
  let nodeWrapper;
  if (provider === 'codex') {
    assert.equal(metadata.bin.codex, 'bin/codex.js');
    nodeWrapper = await fs.realpath(path.join(packageRoot, metadata.bin.codex));
    const nativePackage = createRequire(packagePath).resolve(`@openai/codex-win32-${process.arch}/package.json`);
    const nativeMetadata = JSON.parse(await fs.readFile(nativePackage, 'utf8'));
    assert.equal(nativeMetadata.name, '@openai/codex');
    assert.equal(nativeMetadata.version, `0.157.1-win32-${process.arch}`);
    const target = process.arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc';
    nativeExecutable = await fs.realpath(path.join(path.dirname(nativePackage), 'vendor', target, 'bin/codex.exe'));
  } else {
    assert.equal(metadata.bin.claude, 'bin/claude.exe');
    nativeExecutable = await fs.realpath(path.join(packageRoot, metadata.bin.claude));
  }
  const binary = await fs.open(nativeExecutable, 'r');
  try {
    const signature = Buffer.alloc(2);
    assert.equal((await binary.read(signature, 0, 2, 0)).bytesRead, 2);
    assert.equal(signature.toString('ascii'), 'MZ', 'The fixed Windows CLI must be an installed native executable');
  } finally { await binary.close(); }
  return { provider, nativeExecutable, nodeWrapper, nodeExecutable: nodeInterpreter.realpath };
}

function buildClaudeCandidateArguments({ lifecycle, configurationArguments = [], prompt, sessionId = randomUUID() }) {
  assert(['natural', 'stop'].includes(lifecycle));
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(sessionId));
  const limited = [...configurationArguments, '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', ''];
  const args = lifecycle === 'natural'
    ? [...limited, '--no-session-persistence', '--permission-prompts', 'none', '--max-budget-usd', '0.25',
      '-p', '--output-format', 'json', prompt]
    : [...limited, '--permission-mode', 'plan'];
  // Select once before both observer setup and product launch so the product does not append an unseen ID.
  return [...args, '--session-id', sessionId];
}

module.exports = { invokeCLI, findExecutable, windowsCliManifest, buildClaudeCandidateArguments,
  agentCandidateScenarioNames, selectAgentCandidateScenarios };
