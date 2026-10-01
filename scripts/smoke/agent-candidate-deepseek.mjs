import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const WINDOWS_PRIVATE_DIRECTORY_STAGES = ['inspect-directory', 'build-acl', 'set-acl', 'verify-acl'];
const WINDOWS_PRIVATE_DIRECTORY_OUTPUT = [
  ...WINDOWS_PRIVATE_DIRECTORY_STAGES.map(stage => `private-directory-stage:${stage}`),
  'private-directory-ready'
].join('\n');
const SAFE_FAILURE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'ENOMEM', 'EAGAIN',
  'EIO', 'ENOSPC', 'EISDIR', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
const SAFE_FAILURE_SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGHUP', 'SIGBREAK']);

function safeFailureCode(code) {
  return code === null || Number.isSafeInteger(code) || SAFE_FAILURE_CODES.has(code) ? code : 'unknown';
}

const WINDOWS_PRIVATE_DIRECTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::Out.WriteLine('private-directory-stage:inspect-directory')
$directory = $env:DSC_PRIVATE_CREDENTIAL_DIRECTORY
$item = Get-Item -LiteralPath $directory -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid private directory' }
if (@(Get-ChildItem -LiteralPath $directory -Force).Count -ne 0) { throw 'Private directory is not empty' }
[Console]::Out.WriteLine('private-directory-stage:build-acl')
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$identities = @($current, $system) | Sort-Object -Property Value -Unique
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($current)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
foreach ($identity in $identities) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
[Console]::Out.WriteLine('private-directory-stage:set-acl')
Set-Acl -LiteralPath $directory -AclObject $acl
[Console]::Out.WriteLine('private-directory-stage:verify-acl')
$actual = Get-Acl -LiteralPath $directory
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $current.Value) { throw 'Private directory protection mismatch' }
$rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne @($identities).Count) { throw 'Private directory rule count mismatch' }
foreach ($identity in $identities) {
  $matching = @($rules | Where-Object { $_.IdentityReference.Value -eq $identity.Value })
  if ($matching.Count -ne 1) { throw 'Private directory identity mismatch' }
  $rule = $matching[0]
  if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $inheritance -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
    throw 'Private directory permission mismatch'
  }
}
[Console]::Out.WriteLine('private-directory-ready')
`;

async function restrictWindowsCredentialDirectory(directory, diagnostics) {
  Object.assign(diagnostics, { powershellStage: 'unobserved', signal: null, killed: false,
    durationMs: 0, timeoutMs: 15000, readyTokenMatched: false, stderrPresent: false });
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('Windows system directory is unavailable.');
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const startedAt = performance.now();
  let result;
  try {
    result = await promisify(childProcess.execFile)(executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(WINDOWS_PRIVATE_DIRECTORY_SCRIPT, 'utf16le').toString('base64')], {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 65536,
        encoding: 'utf8',
        env: { SystemRoot: systemRoot, WINDIR: systemRoot, DSC_PRIVATE_CREDENTIAL_DIRECTORY: directory }
      });
    diagnostics.code = 0;
  } catch (error) {
    result = error;
    diagnostics.code = safeFailureCode(error?.code);
    throw error;
  } finally {
    const lines = typeof result?.stdout === 'string' ? result.stdout.trim().split(/\r?\n/u) : [];
    const markers = lines.filter(line => WINDOWS_PRIVATE_DIRECTORY_STAGES.some(
      stage => line === `private-directory-stage:${stage}`));
    diagnostics.powershellStage = markers.at(-1)?.slice('private-directory-stage:'.length) ?? 'unobserved';
    diagnostics.signal = result?.signal === null || SAFE_FAILURE_SIGNALS.has(result?.signal) ? result.signal : 'unknown';
    diagnostics.killed = result?.killed === true;
    diagnostics.durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    diagnostics.readyTokenMatched = lines.includes('private-directory-ready');
    diagnostics.stderrPresent = typeof result?.stderr === 'string' && result.stderr.length > 0;
  }
  diagnostics.signal = null;
  if (result.stdout.trim().replace(/\r\n/gu, '\n') !== WINDOWS_PRIVATE_DIRECTORY_OUTPUT || result.stderr.trim()) {
    throw new Error('Windows private directory was not confirmed.');
  }
}

const MODEL = 'deepseek-flash';
const CODEX_ENDPOINT = 'https://api.deepseek.com/';
const CLAUDE_ENDPOINT = 'https://api.deepseek.com/anthropic';
const CODEX_MODEL_CATALOG = { models: [{
  slug: MODEL,
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
  // The fixed CLI requires instructions even for a tool-free acceptance task.
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
}] };

export async function createDeepSeekConfiguration({ apiKey, temporaryRoot = os.tmpdir() } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || /[\r\n\0]/u.test(apiKey)) {
    throw new Error('A nonempty DeepSeek API key without CR, LF, or NUL is required.');
  }

  let directory;
  let stage = 'create-directory';
  const windowsDiagnostics = {};
  try {
    directory = await fs.mkdtemp(path.join(temporaryRoot, 'dsc-agent-deepseek-'));
    stage = 'protect-directory';
    if (process.platform === 'win32') await restrictWindowsCredentialDirectory(directory, windowsDiagnostics);
    else await fs.chmod(directory, 0o700);
    const codexHome = path.join(directory, 'codex');
    const claudeConfigDir = path.join(directory, 'claude');
    stage = 'create-codex-home';
    await fs.mkdir(codexHome, { mode: 0o700 });
    stage = 'create-claude-home';
    await fs.mkdir(claudeConfigDir, { mode: 0o700 });
    const modelCatalogPath = path.join(codexHome, 'models.json');
    stage = 'write-model-catalog';
    await fs.writeFile(modelCatalogPath, `${JSON.stringify(CODEX_MODEL_CATALOG, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    // JSON basic strings also encode TOML controls, except for DEL.
    const bearerToken = JSON.stringify(apiKey).replace(/\x7f/gu, '\\u007f');
    stage = 'write-codex-config';
    await fs.writeFile(path.join(codexHome, 'config.toml'), [
      `model = "${MODEL}"`,
      'model_provider = "deepseek"',
      'model_reasoning_effort = "high"',
      'forced_login_method = "api"',
      `model_catalog_json = ${JSON.stringify(modelCatalogPath)}`,
      '',
      '[model_providers.deepseek]',
      'name = "DeepSeek"',
      `base_url = "${CODEX_ENDPOINT}"`,
      'wire_api = "responses"',
      `experimental_bearer_token = ${bearerToken}`,
      ''
    ].join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    const claudeSettingsPath = path.join(claudeConfigDir, 'settings.json');
    stage = 'write-claude-settings';
    await fs.writeFile(claudeSettingsPath, `${JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: CLAUDE_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_MODEL: MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
      }
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    return {
      directory,
      authReferences: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir },
      claudeSettingsPath,
      descriptor: {
        backend: 'deepseek',
        model: MODEL,
        endpoints: { codex: CODEX_ENDPOINT, claude: CLAUDE_ENDPOINT },
        credentialSource: 'DEEPSEEK_API_KEY'
      },
      dispose: () => fs.rm(directory, { recursive: true, force: true })
    };
  } catch (error) {
    const diagnostics = { stage, code: safeFailureCode(error?.code),
      ...(stage === 'protect-directory' ? windowsDiagnostics : {}) };
    let message = 'Failed to prepare isolated DeepSeek configuration.';
    if (directory) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch {
        message = 'Failed to prepare isolated DeepSeek configuration and remove its temporary directory.';
      }
    }
    // Only locally constructed fields cross this boundary; native errors may contain credentials.
    throw Object.assign(new Error(message), { diagnostics });
  }
}
