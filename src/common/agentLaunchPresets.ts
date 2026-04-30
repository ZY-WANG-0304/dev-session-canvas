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
  assertAgentDefaultArgsParsable(provider, defaults);

  if (launchPreset === 'custom' && customLaunchCommand?.trim()) {
    return customLaunchCommand.trim();
  }

  return buildAgentPresetCommandLine(provider, defaults, launchPreset);
}

export function buildAgentHistoryResumeCommandLine(
  provider: AgentProviderKind,
  sessionId: string,
  defaults: AgentProviderLaunchDefaults
): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error('恢复会话标识不能为空。');
  }

  const command = defaults.command.trim() || provider;
  const baseArgs = assertAgentDefaultArgsParsable(provider, defaults);
  return formatCommandLine([
    command,
    ...buildAgentResumeArgv(provider, baseArgs, normalizedSessionId)
  ]);
}

export function validateAgentCommandLine(
  commandLine: string,
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): AgentCommandValidationResult {
  const defaultArgsError = getAgentDefaultArgsParseError(provider, defaults);
  if (defaultArgsError) {
    return {
      valid: false,
      error: defaultArgsError
    };
  }

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
      if (matchesAgentPresetArgv(inputArgv, provider, defaults, preset)) {
        return {
          launchPreset: preset
        };
      }
    } catch {
      // Preset reconstruction failures should not break persistence of an explicit command line.
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

export function matchesAgentCommandLinePreset(
  provider: AgentProviderKind,
  commandLine: string,
  defaults: AgentProviderLaunchDefaults,
  preset: Exclude<AgentLaunchPresetKind, 'custom'>
): boolean {
  const validation = validateAgentCommandLine(commandLine, provider, defaults);
  if (!validation.valid || !validation.parsed) {
    return false;
  }

  return matchesAgentPresetArgv([validation.parsed.command, ...validation.parsed.args], provider, defaults, preset);
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
  let doubleQuotedTokenPrefix = '';
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
        doubleQuotedTokenPrefix = '';
      } else if (!quote) {
        quote = 'double';
        doubleQuoteBackslashMode = 'unknown';
        doubleQuotedTokenPrefix = current;
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
              followingCharacter,
              argv[argv.length - 1],
              doubleQuotedTokenPrefix
            )
          ) {
            appendCurrent('\\'.repeat(backslashRunLength));
            quote = undefined;
            doubleQuoteBackslashMode = 'unknown';
            doubleQuotedTokenPrefix = '';
            index += backslashRunLength;
            continue;
          }

          appendCurrent('\\'.repeat(Math.floor(backslashRunLength / 2)));
          if (backslashRunLength % 2 === 1) {
            appendCurrent('"');
          } else {
            quote = undefined;
            doubleQuoteBackslashMode = 'unknown';
            doubleQuotedTokenPrefix = '';
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
  const baseArgs = assertAgentDefaultArgsParsable(provider, defaults);
  const command = defaults.command.trim() || provider;
  if (preset === 'resume') {
    return [command, ...buildAgentResumeArgv(provider, baseArgs)];
  }

  const normalizedArgs = normalizeAgentDefaultArgsForPreset(provider, baseArgs, preset);
  return [command, ...applyAgentPresetArgs(provider, normalizedArgs, preset)];
}

function matchesAgentPresetArgv(
  inputArgv: readonly string[],
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  preset: Exclude<AgentLaunchPresetKind, 'custom'>
): boolean {
  return isEquivalentAgentCommandLine(
    inputArgv,
    buildAgentPresetArgv(provider, defaults, preset),
    provider,
    defaults.command
  );
}

function normalizeAgentDefaultArgsForPreset(
  provider: AgentProviderKind,
  baseArgs: readonly string[],
  preset: AgentLaunchPresetKind
): string[] {
  if (preset === 'default' || preset === 'custom' || preset === 'resume') {
    return [...baseArgs];
  }

  if (provider === 'claude') {
    return stripClaudeExecutionModeArgs(baseArgs);
  }

  return stripCodexExecutionModeArgs(baseArgs);
}

function buildAgentResumeArgv(
  provider: AgentProviderKind,
  baseArgs: readonly string[],
  explicitSessionId?: string
): string[] {
  if (provider === 'claude') {
    const normalizedArgs = stripClaudeResumeTargetArgs(baseArgs);
    return explicitSessionId
      ? [...normalizedArgs, '--resume', explicitSessionId]
      : [...normalizedArgs, '--resume'];
  }

  return buildCodexResumeArgv(baseArgs, explicitSessionId);
}

function stripCodexExecutionModeArgs(baseArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];
  for (let index = 0; index < baseArgs.length; index += 1) {
    const token = baseArgs[index];

    if (
      token === '--yolo' ||
      token === '--full-auto' ||
      token === '--dangerously-bypass-approvals-and-sandbox' ||
      token.startsWith('-s=') ||
      token.startsWith('-a=') ||
      token.startsWith('--sandbox=') ||
      token.startsWith('--ask-for-approval=')
    ) {
      continue;
    }

    if (token === '--sandbox' || token === '-s' || token === '--ask-for-approval' || token === '-a') {
      index = skipOwnedFlagValue(baseArgs, index);
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

function buildCodexResumeArgv(baseArgs: readonly string[], explicitSessionId?: string): string[] {
  const { leadingArgs, resumeArgs } = splitCodexResumeArgs(baseArgs);
  const normalizedResumeArgs = resumeArgs
    ? stripCodexResumeSelectionArgs(resumeArgs, {
        explicitTarget: explicitSessionId !== undefined
      })
    : [];
  return explicitSessionId
    ? [...leadingArgs, 'resume', ...normalizedResumeArgs, explicitSessionId]
    : [...leadingArgs, 'resume', ...normalizedResumeArgs];
}

function splitCodexResumeArgs(baseArgs: readonly string[]): {
  leadingArgs: string[];
  resumeArgs?: string[];
} {
  let nextTokenIsOptionValue = false;
  let encounteredPositional = false;

  for (let index = 0; index < baseArgs.length; index += 1) {
    const token = baseArgs[index];

    if (nextTokenIsOptionValue) {
      nextTokenIsOptionValue = false;
      continue;
    }

    if (token === '--') {
      encounteredPositional = true;
      continue;
    }

    if (!encounteredPositional && token === 'resume') {
      return {
        leadingArgs: [...baseArgs.slice(0, index)],
        resumeArgs: [...baseArgs.slice(index + 1)]
      };
    }

    if (codexOptionConsumesFollowingValue(token)) {
      nextTokenIsOptionValue = true;
      continue;
    }

    if (!encounteredPositional && !isOptionLikeCommandToken(token)) {
      encounteredPositional = true;
    }
  }

  return {
    leadingArgs: [...baseArgs]
  };
}

function stripCodexResumeSelectionArgs(
  resumeArgs: readonly string[],
  options?: {
    explicitTarget?: boolean;
  }
): string[] {
  const normalizedArgs: string[] = [];
  let nextTokenIsOptionValue = false;
  const explicitTarget = options?.explicitTarget ?? false;

  for (let index = 0; index < resumeArgs.length; index += 1) {
    const token = resumeArgs[index];

    if (nextTokenIsOptionValue) {
      normalizedArgs.push(token);
      nextTokenIsOptionValue = false;
      continue;
    }

    if (token === '--') {
      break;
    }

    if (token === '--last') {
      continue;
    }

    if (explicitTarget && (token === '--all' || token === '--include-non-interactive')) {
      continue;
    }

    if (!isOptionLikeCommandToken(token)) {
      continue;
    }

    normalizedArgs.push(token);
    if (codexOptionConsumesFollowingValue(token)) {
      nextTokenIsOptionValue = true;
    }
  }

  return normalizedArgs;
}

function stripClaudeExecutionModeArgs(baseArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];
  for (let index = 0; index < baseArgs.length; index += 1) {
    const token = baseArgs[index];

    if (
      token === '--dangerously-skip-permissions' ||
      token.startsWith('--permission-mode=')
    ) {
      continue;
    }

    if (token === '--permission-mode') {
      index = skipOwnedFlagValue(baseArgs, index);
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

function stripClaudeResumeTargetArgs(baseArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];
  for (let index = 0; index < baseArgs.length; index += 1) {
    const token = baseArgs[index];

    if (
      token.startsWith('--session-id=') ||
      token.startsWith('--resume=') ||
      token.startsWith('--continue=') ||
      token.startsWith('-r=') ||
      token.startsWith('-c=')
    ) {
      continue;
    }

    if (
      token === '--session-id' ||
      token === '--resume' ||
      token === '--continue' ||
      token === '-r' ||
      token === '-c'
    ) {
      index = skipOwnedFlagValue(baseArgs, index);
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

function skipOwnedFlagValue(baseArgs: readonly string[], index: number): number {
  const nextToken = baseArgs[index + 1];
  if (nextToken && !isOptionLikeCommandToken(nextToken)) {
    return index + 1;
  }

  return index;
}

function codexOptionConsumesFollowingValue(token: string): boolean {
  return (
    token === '-c' ||
    token === '--config' ||
    token === '--enable' ||
    token === '--disable' ||
    token === '--remote' ||
    token === '--remote-auth-token-env' ||
    token === '-i' ||
    token === '--image' ||
    token === '-m' ||
    token === '--model' ||
    token === '--local-provider' ||
    token === '-p' ||
    token === '--profile' ||
    token === '-s' ||
    token === '--sandbox' ||
    token === '-C' ||
    token === '--cd' ||
    token === '--add-dir' ||
    token === '-a' ||
    token === '--ask-for-approval'
  );
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
  for (const { aliases, canonicalFlag } of [
    { aliases: ['--session-id'], canonicalFlag: '--session-id' as const },
    { aliases: ['--resume', '-r'], canonicalFlag: '--resume' as const },
    { aliases: ['--continue', '-c'], canonicalFlag: '--continue' as const }
  ]) {
    for (const alias of aliases) {
      if (token === alias) {
        return { flag: canonicalFlag };
      }

      if (token.startsWith(`${alias}=`)) {
        const sessionId = token.slice(alias.length + 1).trim();
        return {
          flag: canonicalFlag,
          sessionId: sessionId || undefined
        };
      }
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
  followingCharacter: string | undefined,
  previousToken: string | undefined,
  quotedTokenPrefix: string
): boolean {
  if (followingCharacter !== undefined && !/\s/.test(followingCharacter)) {
    return false;
  }

  return isLikelyWindowsPathContent(currentValue, previousToken, quotedTokenPrefix);
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

function isLikelyWindowsPathContent(
  value: string,
  previousToken: string | undefined,
  quotedTokenPrefix: string
): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const withoutTrailingBackslashes = trimmed.replace(/\\+$/, '');
  if (withoutTrailingBackslashes && withoutTrailingBackslashes !== trimmed) {
    return isLikelyWindowsPathContent(withoutTrailingBackslashes, previousToken, quotedTokenPrefix);
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
    return isLikelyWindowsRelativePathSegment(trimmed, previousToken, quotedTokenPrefix);
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

function isLikelyWindowsRelativePathSegment(
  value: string,
  previousToken: string | undefined,
  quotedTokenPrefix: string
): boolean {
  if (!isValidWindowsRelativePathSegment(value)) {
    return false;
  }

  // Single-segment relative paths with trailing `\"` are lexically ambiguous:
  // they overlap with ordinary quoted prose. Keep this compatibility layer
  // scoped to path-valued option contexts plus bare positional arguments so
  // generic text under non-path flags still follows standard
  // `CommandLineToArgvW` escaping rules.
  return (
    isBarePositionalCommandToken(previousToken, quotedTokenPrefix) ||
    isLikelyWindowsPathFlagToken(previousToken) ||
    isLikelyWindowsPathFlagAssignmentPrefix(quotedTokenPrefix)
  );
}

function isValidWindowsRelativePathSegment(value: string): boolean {
  return /^[^<>:"/\\|?*]+$/.test(value);
}

function isLikelyWindowsPathFlagAssignmentPrefix(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.endsWith('=')) {
    return false;
  }

  return isLikelyWindowsPathFlagToken(trimmed.slice(0, -1));
}

function isBarePositionalCommandToken(previousToken: string | undefined, quotedTokenPrefix: string): boolean {
  return !quotedTokenPrefix.trim() && !isOptionLikeCommandToken(previousToken ?? '');
}

function isLikelyWindowsPathFlagToken(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!isOptionLikeCommandToken(trimmed)) {
    return false;
  }

  const normalized = trimmed.replace(/^-+/, '').toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(?:^|[-_])(config|path|paths|file|files|dir|dirs|directory|directories|cwd|root|roots|workspace|worktree)(?:$|[-_])/.test(
    normalized
  );
}

function isOptionLikeCommandToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('-');
}

function parseAgentDefaultArgs(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): {
  args?: string[];
  error?: string;
} {
  const parsed = parseCommandLine(defaults.defaultArgs);
  if (parsed.error) {
    return {
      error: `${providerLabel(provider)} 默认启动参数无法解析：${parsed.error}`
    };
  }

  return {
    args: parsed.argv
  };
}

function getAgentDefaultArgsParseError(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): string | undefined {
  return parseAgentDefaultArgs(provider, defaults).error;
}

function assertAgentDefaultArgsParsable(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): string[] {
  const parsed = parseAgentDefaultArgs(provider, defaults);
  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return parsed.args ?? [];
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}
