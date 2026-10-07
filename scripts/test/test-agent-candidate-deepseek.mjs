import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspect, promisify } from 'node:util';

import { createDeepSeekConfiguration } from '../smoke/agent-candidate-deepseek.mjs';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-deepseek-config-test-'));
const fakeApiKey = 'fake-deepseek-key-"quoted"\\backslash\t\b\f\x01\x7f';
const configurations = [];

try {
  const first = await createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot });
  configurations.push(first);
  const second = await createDeepSeekConfiguration({ apiKey: 'fake-second-key', temporaryRoot });
  configurations.push(second);

  assert.notEqual(first.directory, second.directory);
  assert.equal(path.dirname(first.directory), temporaryRoot);
  assert.deepEqual(first.authReferences, {
    CODEX_HOME: path.join(first.directory, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(first.directory, 'claude')
  });
  assert.equal(first.claudeSettingsPath, path.join(first.authReferences.CLAUDE_CONFIG_DIR, 'settings.json'));
  assert.deepEqual((await fs.readdir(first.authReferences.CODEX_HOME)).sort(), ['config.toml', 'models.json']);
  assert.deepEqual(await fs.readdir(first.authReferences.CLAUDE_CONFIG_DIR), ['settings.json']);

  const codexConfigPath = path.join(first.authReferences.CODEX_HOME, 'config.toml');
  const modelCatalogPath = path.join(first.authReferences.CODEX_HOME, 'models.json');
  const codexConfig = await fs.readFile(codexConfigPath, 'utf8');
  const codexLines = codexConfig.trim().split('\n');
  assert.deepEqual(codexLines.slice(0, -1), [
    'model = "deepseek-flash"',
    'model_provider = "deepseek"',
    'model_reasoning_effort = "high"',
    'forced_login_method = "api"',
    `model_catalog_json = ${JSON.stringify(modelCatalogPath)}`,
    '',
    '[model_providers.deepseek]',
    'name = "DeepSeek"',
    'base_url = "https://api.deepseek.com/"',
    'wire_api = "responses"'
  ]);
  const bearerTokenLine = codexLines.at(-1);
  assert.ok(bearerTokenLine.startsWith('experimental_bearer_token = '));
  const bearerTokenString = bearerTokenLine.slice('experimental_bearer_token = '.length);
  assert.equal(JSON.parse(bearerTokenString), fakeApiKey);
  assert.doesNotMatch(bearerTokenString, /[\x00-\x1f\x7f]/u);
  assert.doesNotMatch(codexConfig, /env_key|OPENAI_API_KEY|requires_openai_auth|mcp_servers|preferred_auth_method/u);
  const modelCatalog = JSON.parse(await fs.readFile(modelCatalogPath, 'utf8'));
  assert.deepEqual(modelCatalog, { models: [{
    slug: 'deepseek-flash',
    display_name: 'DeepSeek-Flash',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'high', description: 'Extra high reasoning depth for complex problems' },
      { effort: 'max', description: 'Maximum reasoning depth for the hardest problems' }
    ],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 1,
    base_instructions: 'Follow the user instructions.',
    supports_reasoning_summaries: true,
    reasoning_summary_format: 'experimental',
    default_reasoning_summary: 'none',
    input_modalities: ['text', 'image'],
    context_window: 1048576,
    support_verbosity: true,
    default_verbosity: 'low',
    truncation_policy: { mode: 'tokens', limit: 10000 },
    supports_parallel_tool_calls: true,
    experimental_supported_tools: []
  }] });
  assert.equal(JSON.stringify(modelCatalog).includes(fakeApiKey), false);

  const claudeSettings = JSON.parse(await fs.readFile(first.claudeSettingsPath, 'utf8'));
  assert.deepEqual(claudeSettings, {
    env: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: fakeApiKey,
      ANTHROPIC_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    }
  });
  assert.deepEqual(first.descriptor, {
    backend: 'deepseek',
    model: 'deepseek-flash',
    endpoints: {
      codex: 'https://api.deepseek.com/',
      claude: 'https://api.deepseek.com/anthropic'
    },
    credentialSource: 'DEEPSEEK_API_KEY'
  });
  assert.ok(!JSON.stringify(first).includes('fake-deepseek-key'));

  if (process.platform !== 'win32') {
    for (const directory of [first.directory, ...Object.values(first.authReferences)]) {
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    }
    for (const file of [codexConfigPath, modelCatalogPath, first.claudeSettingsPath]) {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    }
  } else {
    const check = `
$ErrorActionPreference = 'Stop'
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($current)
if ($current -ne 'S-1-5-18') { $allowed += 'S-1-5-18' }
for ($index = 0; $index -lt [int]$env:DSC_ACL_CHECK_COUNT; $index++) {
  $file = [Environment]::GetEnvironmentVariable('DSC_ACL_CHECK_PATH_' + $index)
  $item = if ([IO.Directory]::Exists($file)) { [IO.DirectoryInfo]::new($file) } else { [IO.FileInfo]::new($file) }
  $acl = $item.GetAccessControl()
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne $allowed.Count) { throw 'Credential ACL identity mismatch' }
  foreach ($identity in $allowed) {
    $matching = @()
    foreach ($rule in $rules) {
      if ($rule.IdentityReference.Value -eq $identity) { $matching += $rule }
    }
    if ($matching.Count -ne 1 -or $matching[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $matching[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Credential ACL permission mismatch' }
  }
}
`;
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const checkedPaths = [first.directory, ...Object.values(first.authReferences), codexConfigPath,
      modelCatalogPath, first.claudeSettingsPath];
    const nativeAcl = spawnSync(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(check, 'utf16le').toString('base64')], {
        encoding: 'utf8', timeout: 15000, windowsHide: true,
        env: { SystemRoot: systemRoot, WINDIR: systemRoot, DSC_ACL_CHECK_COUNT: String(checkedPaths.length),
          ...Object.fromEntries(checkedPaths.map((file, index) => [`DSC_ACL_CHECK_PATH_${index}`, file])) }
      });
    assert.equal(nativeAcl.status, 0, nativeAcl.stderr);
  }

  const helperUrl = new URL('../smoke/agent-candidate-deepseek.mjs', import.meta.url).href;
  const runnerUrl = new URL('../smoke/vscode-smoke-runner.mjs', import.meta.url).href;
  const isolatedCheck = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createDeepSeekConfiguration } from ${JSON.stringify(helperUrl)};
    import { buildVSCodeChildEnv } from ${JSON.stringify(runnerUrl)};
    const originalEnvironment = { ...process.env };
    const configuration = await createDeepSeekConfiguration({ apiKey: 'fake-isolated-key' });
    try {
      assert.deepEqual({ ...process.env }, originalEnvironment);
      const env = buildVSCodeChildEnv(configuration.authReferences);
      assert.equal(env.DEEPSEEK_API_KEY, undefined);
      assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
      assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.CODEX_HOME, configuration.authReferences.CODEX_HOME);
      assert.equal(env.CLAUDE_CONFIG_DIR, configuration.authReferences.CLAUDE_CONFIG_DIR);
    } finally {
      await configuration.dispose();
    }
  `], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      PATH: path.dirname(process.execPath),
      HOME: temporaryRoot,
      USERPROFILE: temporaryRoot,
      TMPDIR: temporaryRoot,
      TMP: temporaryRoot,
      TEMP: temporaryRoot,
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT } : {}),
      CODEX_HOME: path.join(temporaryRoot, 'unread-original-codex'),
      CLAUDE_CONFIG_DIR: path.join(temporaryRoot, 'unread-original-claude'),
      DEEPSEEK_API_KEY: 'fake-filtered-deepseek-key',
      ANTHROPIC_AUTH_TOKEN: 'fake-filtered-anthropic-token',
      OPENAI_API_KEY: 'fake-filtered-openai-key'
    }
  });
  assert.equal(isolatedCheck.status, 0, isolatedCheck.stderr);

  const directoriesBeforeInvalidInputs = await fs.readdir(temporaryRoot);
  for (const apiKey of [undefined, null, 1, '', ' \t ', 'fake-key\r', 'fake-key\n', 'fake-key\0']) {
    await assert.rejects(createDeepSeekConfiguration({ apiKey, temporaryRoot }), {
      message: 'A nonempty DeepSeek API key without CR, LF, or NUL is required.'
    });
  }
  assert.deepEqual(await fs.readdir(temporaryRoot), directoriesBeforeInvalidInputs);

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSystemRoot = process.env.SystemRoot;
  const originalExecFile = childProcess.execFile;
  const originalAclWriteFile = fs.writeFile;
  try {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    process.env.SystemRoot = 'C:\\Windows';
    let confirmed = false;
    let writes = 0;
    const stages = ['inspect-directory', 'build-acl', 'set-acl', 'verify-acl'];
    const outputThrough = stage => stages.slice(0, stages.indexOf(stage) + 1)
      .map(value => `private-directory-stage:${value}`).join('\r\n');
    const confirmedOutput = `${outputThrough('verify-acl')}\r\nprivate-directory-ready\r\n`;
    let result = { stdout: confirmedOutput, stderr: '' };
    const fakeExecFile = () => assert.fail('The async ACL command must use its promisified contract');
    fakeExecFile[promisify.custom] = async (executable, args, options) => {
      assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 65536);
      assert.deepEqual(Object.keys(options.env).sort(), ['DSC_PRIVATE_CREDENTIAL_DIRECTORY', 'SystemRoot', 'WINDIR']);
      assert.deepEqual(await fs.readdir(options.env.DSC_PRIVATE_CREDENTIAL_DIRECTORY), [], 'No credential exists before ACL confirmation');
      assert.equal(JSON.stringify({ args, options }).includes(fakeApiKey), false);
      const script = Buffer.from(args[4], 'base64').toString('utf16le');
      assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/u);
      assert.match(script, /GetCurrent\(\)\.User/u);
      assert.match(script, /S-1-5-18/u);
      assert.match(script, /SetAccessControl[\s\S]+GetAccessControl[\s\S]+GetAccessRules/u);
      assert.match(script, /DirectoryInfo\]::new[\s\S]+\.Exists[\s\S]+ReparsePoint[\s\S]+GetFileSystemInfos/u);
      assert.doesNotMatch(script, /Get-Item|Get-ChildItem|Get-Acl|Set-Acl|Sort-Object|Where-Object|Import-Module/u);
      assert.deepEqual([...script.matchAll(/WriteLine\('private-directory-stage:([^']+)'\)/gu)]
        .map(match => match[1]), stages);
      if (result instanceof Error) throw result;
      confirmed = result.stdout.trim() === confirmedOutput.trim() && !result.stderr.trim();
      return result;
    };
    childProcess.execFile = fakeExecFile;
    fs.writeFile = async (...args) => {
      assert.equal(confirmed, true, 'No configuration may be written before ACL confirmation');
      writes += 1;
      return originalAclWriteFile(...args);
    };
    const protectedConfiguration = await createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot });
    await protectedConfiguration.dispose();
    assert.equal(writes, 3);
    const raw = `raw-sensitive-directory ${fakeApiKey}`;
    const commandError = properties => Object.assign(new Error(raw), {
      cmd: raw, path: raw, env: { DEEPSEEK_API_KEY: fakeApiKey }, cause: new Error(raw), ...properties
    });
    const failures = [
      [commandError({ code: null, signal: 'SIGTERM', killed: true, stdout: outputThrough('build-acl'), stderr: '' }),
        { powershellStage: 'build-acl', code: null, signal: 'SIGTERM', killed: true, readyTokenMatched: false, stderrPresent: false }],
      [commandError({ code: 'ENOENT' }),
        { powershellStage: 'unobserved', code: 'ENOENT', signal: 'unknown', killed: false, readyTokenMatched: false, stderrPresent: false }],
      [commandError({ code: 'EACCES', signal: null }),
        { powershellStage: 'unobserved', code: 'EACCES', signal: null, killed: false, readyTokenMatched: false, stderrPresent: false }],
      [commandError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: outputThrough('set-acl'), stderr: raw }),
        { powershellStage: 'set-acl', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', signal: 'unknown', killed: false, readyTokenMatched: false, stderrPresent: true }],
      [commandError({ code: 1, signal: null, stdout: outputThrough('verify-acl'), stderr: raw }),
        { powershellStage: 'verify-acl', code: 1, signal: null, killed: false, readyTokenMatched: false, stderrPresent: true }],
      [commandError({ code: raw, signal: raw, killed: raw,
        stdout: `${outputThrough('build-acl')}\nprivate-directory-stage:${raw}\n`, stderr: raw }),
        { powershellStage: 'build-acl', code: 'unknown', signal: 'unknown', killed: false, readyTokenMatched: false, stderrPresent: true }],
      [{ stdout: '', stderr: '' },
        { powershellStage: 'unobserved', code: 0, signal: null, killed: false, readyTokenMatched: false, stderrPresent: false }],
      [{ stdout: 'private-directory-ready\n', stderr: '' },
        { powershellStage: 'unobserved', code: 0, signal: null, killed: false, readyTokenMatched: true, stderrPresent: false }],
      [{ stdout: confirmedOutput, stderr: raw },
        { powershellStage: 'verify-acl', code: 0, signal: null, killed: false, readyTokenMatched: true, stderrPresent: true }],
      [{ stdout: `${confirmedOutput}${raw}\n`, stderr: '' },
        { powershellStage: 'verify-acl', code: 0, signal: null, killed: false, readyTokenMatched: true, stderrPresent: false }]
    ];
    for (const [failure, expected] of failures) {
      result = failure;
      confirmed = false;
      writes = 0;
      await assert.rejects(createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot }), error => {
        assert.equal(error.message, 'Failed to prepare isolated DeepSeek configuration.');
        const { durationMs, ...diagnostics } = error.diagnostics;
        assert.deepEqual(diagnostics, { stage: 'protect-directory', timeoutMs: 15000, ...expected });
        assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 0);
        assert.deepEqual(Object.keys(error), ['diagnostics']);
        for (const field of ['cause', 'cmd', 'path', 'env', 'stdout', 'stderr', 'timedOut']) {
          assert.equal(error[field], undefined);
          assert.equal(error.diagnostics[field], undefined);
        }
        assert.doesNotMatch(`${inspect(error)}\n${JSON.stringify(error)}`, /raw-sensitive-directory|fake-deepseek-key/u);
        return true;
      });
      assert.equal(writes, 0);
      assert.deepEqual(await fs.readdir(temporaryRoot), directoriesBeforeInvalidInputs);
    }
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
    childProcess.execFile = originalExecFile;
    fs.writeFile = originalAclWriteFile;
  }

  const originalWriteFile = fs.writeFile;
  try {
    fs.writeFile = async (...args) => {
      if (args[0].endsWith('settings.json')) throw new Error(`Simulated failure containing ${fakeApiKey}`);
      return originalWriteFile(...args);
    };
    await assert.rejects(createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot }), error => {
      assert.equal(error.message, 'Failed to prepare isolated DeepSeek configuration.');
      assert.deepEqual(error.diagnostics, { stage: 'write-claude-settings', code: 'unknown' });
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(`${inspect(error)}\n${JSON.stringify(error)}`, /fake-deepseek-key/u);
      return true;
    });
  } finally {
    fs.writeFile = originalWriteFile;
  }
  assert.deepEqual(await fs.readdir(temporaryRoot), directoriesBeforeInvalidInputs);

  await first.dispose();
  await first.dispose();
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' });
  assert.ok((await fs.stat(second.claudeSettingsPath)).isFile());
  assert.ok((await fs.stat(temporaryRoot)).isDirectory());
  console.log('DeepSeek agent candidate configuration tests passed');
} finally {
  for (const configuration of configurations) await configuration.dispose();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
