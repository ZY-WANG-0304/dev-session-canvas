import type {
  AgentLaunchPresetKind,
  AgentProviderKind,
  AgentProviderLaunchDefaults,
  AgentLaunchDefaultsByProvider
} from './protocol';

export interface ParsedAgentCommandLine {
  command: string;
  args: string[];
}

export interface AgentCommandValidationResult {
  valid: boolean;
  error?: string;
  parsed?: ParsedAgentCommandLine;
}

export interface ClaudeCommandSessionFlag {
  flag: '--session-id' | '--resume' | '--continue';
  sessionId?: string;
}

const WINDOWS_EXECUTABLE_SUFFIX = /\.(exe|cmd|bat|com)$/i;
type DoubleQuotedBackslashMode = 'unknown' | 'legacy' | 'literal';

export function buildAgentPresetCommandLine(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  preset: AgentLaunchPresetKind
): string {
  return formatCommandLine(buildAgentPresetArgv(provider, defaults, preset));
}

export function buildFreshAgentCommandLine(
  provider: AgentProviderKind,
  launchPreset: AgentLaunchPresetKind,
  customLaunchCommand: string | undefined,
  defaults: AgentProviderLaunchDefaults
): string {
  if (launchPreset === 'custom' && customLaunchCommand?.trim()) {
    return customLaunchCommand.trim();
  }

  return buildAgentPresetCommandLine(provider, defaults, launchPreset);
}

export function validateAgentCommandLine(
  commandLine: string,
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): AgentCommandValidationResult {
  const parsed = parseCommandLine(commandLine);
  if (parsed.error) {
    return {
      valid: false,
      error: parsed.error
    };
  }

  if (parsed.argv.length === 0) {
    return {
      valid: false,
      error: '启动命令不能为空。'
    };
  }

  const [command, ...args] = parsed.argv;
  if (!isProviderCommandMatch(command, provider, defaults.command)) {
    return {
      valid: false,
      error:
        provider === 'claude'
          ? '命令必须以当前 Claude Code 命令或 claude 开头。'
          : '命令必须以当前 Codex 命令或 codex 开头。'
    };
  }

  return {
    valid: true,
    parsed: {
      command,
      args
    }
  };
}

export function classifyAgentLaunchPreset(
  provider: AgentProviderKind,
  commandLine: string,
  defaults: AgentProviderLaunchDefaults
): {
  launchPreset: AgentLaunchPresetKind;
  customLaunchCommand?: string;
} {
  if (!commandLine.trim()) {
    return {
      launchPreset: 'default'
    };
  }

  const validation = validateAgentCommandLine(commandLine, provider, defaults);
  if (!validation.valid || !validation.parsed) {
    return {
      launchPreset: 'custom',
      customLaunchCommand: commandLine.trim()
    };
  }

  const inputArgv = [validation.parsed.command, ...validation.parsed.args];
  for (const preset of ['default', 'resume', 'yolo', 'sandbox'] as const) {
    try {
      if (
        isEquivalentAgentCommandLine(
          inputArgv,
          buildAgentPresetArgv(provider, defaults, preset),
          provider,
          defaults.command
        )
      ) {
        return {
          launchPreset: preset
        };
      }
    } catch {
      // Invalid default args should not prevent an explicit custom command from being persisted as custom.
    }
  }

  return {
    launchPreset: 'custom',
    customLaunchCommand: commandLine.trim()
  };
}

export function parseFullAgentCommandLine(commandLine: string): ParsedAgentCommandLine {
  const parsed = parseCommandLine(commandLine);
  if (parsed.error || parsed.argv.length === 0) {
    throw new Error(parsed.error ?? '启动命令不能为空。');
  }

  const [command, ...args] = parsed.argv;
  return {
    command,
    args
  };
}

export function hasCommandLineFlag(argv: readonly string[], flag: string): boolean {
  const normalizedFlag = flag.trim();
  if (!normalizedFlag) {
    return false;
  }

  return argv.some((token) => token === normalizedFlag || token.startsWith(`${normalizedFlag}=`));
}

export function hasAnyCommandLineFlag(argv: readonly string[], flags: readonly string[]): boolean {
  return flags.some((flag) => hasCommandLineFlag(argv, flag));
}

export function extractClaudeCommandSessionFlag(
  argv: readonly string[]
): ClaudeCommandSessionFlag | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]?.trim();
    if (!token) {
      continue;
    }

    const matchedFlag = matchClaudeCommandSessionFlag(token);
    if (!matchedFlag) {
      continue;
    }

    if (matchedFlag.sessionId !== undefined) {
      return {
        flag: matchedFlag.flag,
        sessionId: matchedFlag.sessionId
      };
    }

    const nextToken = argv[index + 1]?.trim();
    return {
      flag: matchedFlag.flag,
      sessionId: nextToken && !nextToken.startsWith('-') ? nextToken : undefined
    };
  }

  return null;
}

export function createDefaultAgentLaunchDefaults(): AgentLaunchDefaultsByProvider {
  return {
    codex: {
      command: 'codex',
      defaultArgs: ''
    },
    claude: {
      command: 'claude',
      defaultArgs: ''
    }
  };
}

export function formatCommandLine(argv: readonly string[]): string {
  return argv.map(quoteCommandToken).join(' ');
}

export function quoteCommandToken(value: string): string {
  if (!value) {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@%+=,\\-]+$/.test(value)) {
    return value;
  }

  if (!value.includes("'") && !value.includes('\n') && !value.includes('\r')) {
    return quoteSingleQuotedCommandToken(value);
  }

  return quoteDoubleQuotedCommandToken(value);
}

export function parseCommandLine(commandLine: string): {
  argv: string[];
  error?: string;
} {
  const argv: string[] = [];
  let current = '';
  let tokenInProgress = false;
  let quote: 'single' | 'double' | undefined;
  let doubleQuoteBackslashMode: DoubleQuotedBackslashMode = 'unknown';
  const appendCurrent = (value: string): void => {
    current += value;
    tokenInProgress = true;
  };

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];

    if (character === '"') {
      if (quote === 'double') {
        quote = undefined;
        doubleQuoteBackslashMode = 'unknown';
      } else if (!quote) {
        quote = 'double';
        doubleQuoteBackslashMode = 'unknown';
        tokenInProgress = true;
      } else {
        appendCurrent(character);
      }
      continue;
    }

    if (character === "'") {
      if (quote === 'single') {
        quote = undefined;
      } else if (!quote) {
        quote = 'single';
        tokenInProgress = true;
      } else {
        appendCurrent(character);
      }
      continue;
    }

    if (character === '\\') {
      const nextCharacter = commandLine[index + 1];
      if (quote === 'single') {
        appendCurrent(character);
        continue;
      }
      if (quote === 'double') {
        let backslashRunLength = 1;
        while (commandLine[index + backslashRunLength] === '\\') {
          backslashRunLength += 1;
        }

        const nextAfterBackslashes = commandLine[index + backslashRunLength];
        if (nextAfterBackslashes === '"') {
          const followingCharacter = commandLine[index + backslashRunLength + 1];
          if (
            backslashRunLength % 2 === 1 &&
            shouldTreatDoubleQuoteAsWindowsPathTerminator(
              current + '\\'.repeat(backslashRunLength),
              followingCharacter
            )
          ) {
            appendCurrent('\\'.repeat(backslashRunLength));
            quote = undefined;
            doubleQuoteBackslashMode = 'unknown';
            index += backslashRunLength;
            continue;
          }

          appendCurrent('\\'.repeat(Math.floor(backslashRunLength / 2)));
          if (backslashRunLength % 2 === 1) {
            appendCurrent('"');
          } else {
            quote = undefined;
            doubleQuoteBackslashMode = 'unknown';
          }
          index += backslashRunLength;
          continue;
        }

        doubleQuoteBackslashMode = resolveDoubleQuotedBackslashMode(
          doubleQuoteBackslashMode,
          current,
          backslashRunLength,
          nextAfterBackslashes
        );
        if (doubleQuoteBackslashMode === 'legacy' && backslashRunLength % 2 === 0) {
          appendCurrent('\\'.repeat(backslashRunLength / 2));
        } else {
          appendCurrent('\\'.repeat(backslashRunLength));
        }
        index += backslashRunLength - 1;
        continue;
      }
      if (nextCharacter && (/\s/.test(nextCharacter) || nextCharacter === '"' || nextCharacter === "'")) {
        appendCurrent(nextCharacter);
        index += 1;
        continue;
      }
      appendCurrent(character);
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (tokenInProgress) {
        argv.push(current);
        current = '';
        tokenInProgress = false;
      }
      continue;
    }

    appendCurrent(character);
  }

  if (quote) {
    return {
      argv: [],
      error: quote === 'double' ? '双引号未闭合。' : '单引号未闭合。'
    };
  }

  if (tokenInProgress) {
    argv.push(current);
  }

  return {
    argv
  };
}

function applyAgentPresetArgs(
  provider: AgentProviderKind,
  baseArgs: string[],
  preset: AgentLaunchPresetKind
): string[] {
  switch (preset) {
    case 'resume':
      return provider === 'claude' ? [...baseArgs, '--resume'] : [...baseArgs, 'resume'];
    case 'yolo':
      return provider === 'claude'
        ? [...baseArgs, '--dangerously-skip-permissions']
        : [...baseArgs, '--yolo'];
    case 'sandbox':
      return provider === 'claude'
        ? [...baseArgs, '--permission-mode', 'plan']
        : [...baseArgs, '--sandbox', 'workspace-write'];
    case 'custom':
    case 'default':
    default:
      return [...baseArgs];
  }
}

function buildAgentPresetArgv(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  preset: AgentLaunchPresetKind
): string[] {
  const baseArgs = parseAgentDefaultArgsOrThrow(provider, defaults);
  const command = defaults.command.trim() || provider;
  return [command, ...applyAgentPresetArgs(provider, baseArgs, preset)];
}

function isProviderCommandMatch(
  candidateCommand: string,
  provider: AgentProviderKind,
  configuredCommand: string
): boolean {
  const normalizedCandidate = normalizeConfiguredCommandValue(candidateCommand);
  if (!normalizedCandidate) {
    return false;
  }

  if (normalizedCandidate === normalizeStandardProviderAlias(provider)) {
    return true;
  }

  const normalizedConfigured = normalizeConfiguredCommandValue(configuredCommand);
  return Boolean(normalizedConfigured && normalizedCandidate === normalizedConfigured);
}

function matchClaudeCommandSessionFlag(token: string): ClaudeCommandSessionFlag | null {
  for (const flag of ['--session-id', '--resume', '--continue'] as const) {
    if (token === flag) {
      return { flag };
    }

    if (token.startsWith(`${flag}=`)) {
      const sessionId = token.slice(flag.length + 1).trim();
      return {
        flag,
        sessionId: sessionId || undefined
      };
    }
  }

  return null;
}

function isEquivalentAgentCommandLine(
  inputArgv: readonly string[],
  presetArgv: readonly string[],
  provider: AgentProviderKind,
  configuredCommand: string
): boolean {
  if (inputArgv.length === 0 || presetArgv.length === 0) {
    return false;
  }

  const [inputCommand, ...inputArgs] = inputArgv;
  const [presetCommand, ...presetArgs] = presetArgv;
  return (
    isProviderCommandMatch(inputCommand, provider, configuredCommand) &&
    isProviderCommandMatch(presetCommand, provider, configuredCommand) &&
    normalizeComparableArgv(inputArgs) === normalizeComparableArgv(presetArgs)
  );
}

function normalizeComparableArgv(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function normalizeCommandIdentity(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return '';
  }

  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const basename = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  return basename.replace(WINDOWS_EXECUTABLE_SUFFIX, '').toLowerCase();
}

function normalizeConfiguredCommandValue(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return '';
  }

  return isWindowsCommandToken(trimmed) ? trimmed.replace(WINDOWS_EXECUTABLE_SUFFIX, '').toLowerCase() : trimmed;
}

function normalizeStandardProviderAlias(provider: AgentProviderKind): string {
  return normalizeCommandIdentity(provider);
}

function quoteSingleQuotedCommandToken(value: string): string {
  return `'${value}'`;
}

function quoteDoubleQuotedCommandToken(value: string): string {
  let quoted = '"';
  let backslashRunLength = 0;

  for (const character of value) {
    if (character === '\\') {
      backslashRunLength += 1;
      continue;
    }

    if (character === '\n') {
      quoted += '\\'.repeat(backslashRunLength);
      backslashRunLength = 0;
      quoted += '\\n';
      continue;
    }

    if (character === '"') {
      quoted += '\\'.repeat(backslashRunLength * 2 + 1);
      quoted += '"';
      backslashRunLength = 0;
      continue;
    }

    quoted += '\\'.repeat(backslashRunLength);
    backslashRunLength = 0;
    quoted += character;
  }

  quoted += '\\'.repeat(backslashRunLength * 2);
  quoted += '"';
  return quoted;
}

function resolveDoubleQuotedBackslashMode(
  currentMode: DoubleQuotedBackslashMode,
  currentValue: string,
  backslashRunLength: number,
  nextCharacter: string | undefined
): DoubleQuotedBackslashMode {
  if (currentMode !== 'unknown') {
    return currentMode;
  }

  return shouldUseLegacyEscapedBackslashes(currentValue, backslashRunLength, nextCharacter)
    ? 'legacy'
    : 'literal';
}

function shouldUseLegacyEscapedBackslashes(
  currentValue: string,
  backslashRunLength: number,
  nextCharacter: string | undefined
): boolean {
  if (backslashRunLength < 2) {
    return false;
  }

  const trimmed = currentValue.trim();
  if (/^[A-Za-z]:$/.test(trimmed) || /^[A-Za-z]:[^\\/]+$/.test(trimmed)) {
    return true;
  }

  // Older formatter output escaped the leading UNC `\\` as `\\\\`.
  if (!trimmed && backslashRunLength >= 4 && nextCharacter !== undefined && nextCharacter !== '\\') {
    return true;
  }

  return false;
}

function shouldTreatDoubleQuoteAsWindowsPathTerminator(
  currentValue: string,
  followingCharacter: string | undefined
): boolean {
  if (followingCharacter !== undefined && !/\s/.test(followingCharacter)) {
    return false;
  }

  return isLikelyWindowsPathContent(currentValue);
}

function isWindowsCommandToken(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return true;
  }

  if (trimmed.includes('\\')) {
    return true;
  }

  return !trimmed.includes('/') && WINDOWS_EXECUTABLE_SUFFIX.test(trimmed);
}

function isLikelyWindowsPathContent(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const withoutTrailingBackslashes = trimmed.replace(/\\+$/, '');
  if (withoutTrailingBackslashes && withoutTrailingBackslashes !== trimmed) {
    return isLikelyWindowsPathContent(withoutTrailingBackslashes);
  }

  if (trimmed.includes('/')) {
    return false;
  }

  if (/^[A-Za-z]:($|\\)/.test(trimmed) || isLikelyWindowsUncPath(trimmed)) {
    return true;
  }

  if (/^[A-Za-z]:[^\\/]+$/.test(trimmed)) {
    return true;
  }

  if (!trimmed.includes('\\')) {
    return isLikelyWindowsRelativePathSegment(trimmed);
  }

  return isLikelyWindowsRelativePath(trimmed);
}

function isLikelyWindowsUncPath(value: string): boolean {
  const segments = value.slice(2).split('\\');
  if (segments.length < 2) {
    return false;
  }

  const [host, share, ...pathSegments] = segments;
  if (!host || !share) {
    return false;
  }

  if (!/^[^\\/\s]+$/.test(host)) {
    return false;
  }

  if (!isValidWindowsUncPathComponent(share)) {
    return false;
  }

  return pathSegments.every((segment) => segment.length > 0 && isValidWindowsUncPathComponent(segment));
}

function isValidWindowsUncPathComponent(value: string): boolean {
  return isValidWindowsRelativePathSegment(value);
}

function isLikelyWindowsRelativePath(value: string): boolean {
  const segments = value.split('\\');
  if (segments.length < 2) {
    return false;
  }

  return segments.every((segment) => segment.length > 0 && isValidWindowsRelativePathSegment(segment));
}

function isLikelyWindowsRelativePathSegment(value: string): boolean {
  if (!/\s/.test(value)) {
    return false;
  }

  return isValidWindowsRelativePathSegment(value);
}

function isValidWindowsRelativePathSegment(value: string): boolean {
  return /^[^<>:"/\\|?*]+$/.test(value);
}

function parseAgentDefaultArgsOrThrow(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): string[] {
  const parsed = parseCommandLine(defaults.defaultArgs);
  if (!parsed.error) {
    return parsed.argv;
  }

  throw new Error(`${providerLabel(provider)} 默认启动参数无法解析：${parsed.error}`);
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}
