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

export type AgentLaunchMessageId =
  | 'resumeSessionIdEmpty'
  | 'forkSessionIdEmpty'
  | 'launchCommandEmpty'
  | 'claudeCommandMismatch'
  | 'codexCommandMismatch'
  | 'doubleQuoteUnclosed'
  | 'singleQuoteUnclosed'
  | 'defaultArgsParseError'
  | 'defaultArgsConflict';

export type AgentLaunchConflictDescriptionId =
  | 'positionalArgumentSeparator'
  | 'sessionSelectionArgument'
  | 'sessionTargetSubcommand'
  | 'positionalArgument'
  | 'forkFlagArgument'
  | 'sessionTargetArgument';

export interface AgentLaunchMessageDescriptor {
  id: AgentLaunchMessageId;
  params?: Record<string, string>;
  cause?: AgentLaunchMessageDescriptor;
}

export interface AgentCommandValidationResult {
  valid: boolean;
  error?: string;
  errorDescriptor?: AgentLaunchMessageDescriptor;
  parsed?: ParsedAgentCommandLine;
}

export interface ClaudeCommandSessionFlag {
  flag: '--session-id' | '--resume' | '--continue';
  sessionId?: string;
}

export interface AgentLaunchIntentOptions {
  launchPreset?: AgentLaunchPresetKind;
  customLaunchCommand?: string;
  templateArgv?: readonly string[];
}

const WINDOWS_EXECUTABLE_SUFFIX = /\.(exe|cmd|bat|com)$/i;
type DoubleQuotedBackslashMode = 'unknown' | 'legacy' | 'literal';
type AgentDefaultArgsConflict = {
  token: string;
  descriptionId: AgentLaunchConflictDescriptionId;
};
type AgentLaunchArgConflictKey =
  | 'codex-execution-mode'
  | 'codex-model'
  | 'codex-profile'
  | 'codex-cwd'
  | 'codex-local-provider'
  | 'claude-execution-mode'
  | 'claude-model';

export class AgentLaunchPresetError extends Error {
  public readonly code = 'DEV_SESSION_CANVAS_AGENT_LAUNCH_PRESET_ERROR';

  public constructor(public readonly descriptor: AgentLaunchMessageDescriptor) {
    super(formatAgentLaunchMessageDescriptor(descriptor));
    this.name = 'AgentLaunchPresetError';
  }
}

export function isAgentLaunchPresetError(error: unknown): error is AgentLaunchPresetError {
  return error instanceof AgentLaunchPresetError ||
    (isRecord(error) && error.code === 'DEV_SESSION_CANVAS_AGENT_LAUNCH_PRESET_ERROR');
}

export function getAgentLaunchErrorDescriptor(error: unknown): AgentLaunchMessageDescriptor | undefined {
  if (!isAgentLaunchPresetError(error)) {
    return undefined;
  }

  const descriptor = error.descriptor;
  return isAgentLaunchMessageDescriptor(descriptor) ? descriptor : undefined;
}

export function formatAgentLaunchMessageDescriptor(descriptor: AgentLaunchMessageDescriptor): string {
  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'resumeSessionIdEmpty':
      return 'Resume session id cannot be empty.';
    case 'forkSessionIdEmpty':
      return 'Fork session id cannot be empty.';
    case 'launchCommandEmpty':
      return 'Launch command cannot be empty.';
    case 'claudeCommandMismatch':
      return 'Command must start with the current Claude Code command or claude.';
    case 'codexCommandMismatch':
      return 'Command must start with the current Codex command or codex.';
    case 'doubleQuoteUnclosed':
      return 'Double quote is not closed.';
    case 'singleQuoteUnclosed':
      return 'Single quote is not closed.';
    case 'defaultArgsParseError': {
      const message = descriptor.cause
        ? formatAgentLaunchMessageDescriptor(descriptor.cause)
        : params.message ?? '';
      return `${params.provider ?? 'Agent'} default launch arguments could not be parsed: ${message}`;
    }
    case 'defaultArgsConflict': {
      const descriptionId = params.descriptionId as AgentLaunchConflictDescriptionId | undefined;
      const description = descriptionId
        ? formatAgentLaunchConflictDescription(descriptionId)
        : params.description ?? 'argument';
      return `${params.provider ?? 'Agent'} default launch arguments cannot include ${description} ${
        params.token ?? ''
      } because it conflicts with Resume / Fork. Remove it from Default args, use the Resume / Fork entry instead, or put one-time session targets in a custom launch command.`;
    }
    default:
      return 'Unable to parse the Agent launch command.';
  }
}

export function formatAgentLaunchConflictDescription(id: AgentLaunchConflictDescriptionId): string {
  switch (id) {
    case 'positionalArgumentSeparator':
      return 'positional argument separator';
    case 'sessionSelectionArgument':
      return 'session selection argument';
    case 'sessionTargetSubcommand':
      return 'session target subcommand';
    case 'positionalArgument':
      return 'positional argument (prompt/session)';
    case 'forkFlagArgument':
      return 'Fork flag argument';
    case 'sessionTargetArgument':
      return 'session target argument';
    default:
      return 'argument';
  }
}

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
  defaults: AgentProviderLaunchDefaults,
  launchIntent?: AgentLaunchIntentOptions
): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new AgentLaunchPresetError({ id: 'resumeSessionIdEmpty' });
  }

  const command = defaults.command.trim() || provider;
  const baseArgs = resolveAgentResumeForkBaseArgs(provider, defaults, launchIntent);
  return formatCommandLine([
    command,
    ...buildAgentResumeArgv(provider, baseArgs, normalizedSessionId)
  ]);
}

export function buildAgentBranchCommandLine(
  provider: AgentProviderKind,
  sessionId: string,
  defaults: AgentProviderLaunchDefaults,
  launchIntent?: AgentLaunchIntentOptions
): string {
  return provider === 'claude'
    ? buildClaudeBranchCommandLine(sessionId, defaults, launchIntent)
    : buildCodexBranchCommandLine(sessionId, defaults, launchIntent);
}

export function buildCodexBranchCommandLine(
  sessionId: string,
  defaults: AgentProviderLaunchDefaults,
  launchIntent?: AgentLaunchIntentOptions
): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new AgentLaunchPresetError({ id: 'forkSessionIdEmpty' });
  }

  const command = defaults.command.trim() || 'codex';
  const baseArgs = resolveAgentResumeForkBaseArgs('codex', defaults, launchIntent);
  return formatCommandLine([
    command,
    ...buildCodexBranchArgv(baseArgs, normalizedSessionId)
  ]);
}

export function buildClaudeBranchCommandLine(
  sessionId: string,
  defaults: AgentProviderLaunchDefaults,
  launchIntent?: AgentLaunchIntentOptions
): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new AgentLaunchPresetError({ id: 'forkSessionIdEmpty' });
  }

  const command = defaults.command.trim() || 'claude';
  const baseArgs = resolveAgentResumeForkBaseArgs('claude', defaults, launchIntent);
  return formatCommandLine([
    command,
    ...buildClaudeBranchArgv(baseArgs, normalizedSessionId)
  ]);
}

export function validateAgentCommandLine(
  commandLine: string,
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): AgentCommandValidationResult {
  const defaultArgsErrorDescriptor = getAgentDefaultArgsParseErrorDescriptor(provider, defaults);
  if (defaultArgsErrorDescriptor) {
    return invalidAgentCommandValidationResult(defaultArgsErrorDescriptor);
  }

  const parsed = parseCommandLine(commandLine);
  if (parsed.error) {
    return invalidAgentCommandValidationResult(
      parsed.errorDescriptor ?? {
        id: 'launchCommandEmpty',
        params: { message: parsed.error }
      }
    );
  }

  if (parsed.argv.length === 0) {
    return invalidAgentCommandValidationResult({ id: 'launchCommandEmpty' });
  }

  const [command, ...args] = parsed.argv;
  if (!isProviderCommandMatch(command, provider, defaults.command)) {
    return invalidAgentCommandValidationResult({
      id: provider === 'claude' ? 'claudeCommandMismatch' : 'codexCommandMismatch'
    });
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
    throw new AgentLaunchPresetError(parsed.errorDescriptor ?? { id: 'launchCommandEmpty' });
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
  return extractClaudeCommandSessionFlagByTarget(argv, ['--session-id', '--resume', '--continue']);
}

export function hasClaudeForkSessionFlag(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--fork-session' || token.startsWith('--fork-session='));
}

export function hasCodexForkSubcommand(argv: readonly string[]): boolean {
  return findCodexSessionSubcommandIndex(argv, ['fork']) >= 0;
}

export function extractClaudeCommandRuntimeSessionFlag(
  argv: readonly string[]
): ClaudeCommandSessionFlag | null {
  return hasClaudeForkSessionFlag(argv)
    ? extractClaudeCommandSessionFlagByTarget(argv, ['--session-id'], { requireSessionId: true })
    : extractClaudeCommandSessionFlag(argv);
}

function extractClaudeCommandSessionFlagByTarget(
  argv: readonly string[],
  targetFlags: readonly ClaudeCommandSessionFlag['flag'][],
  options: { requireSessionId?: boolean } = {}
): ClaudeCommandSessionFlag | null {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]?.trim();
    if (!token) {
      continue;
    }

    const matchedFlag = matchClaudeCommandSessionFlag(token);
    if (!matchedFlag || !targetFlags.includes(matchedFlag.flag)) {
      continue;
    }

    if (matchedFlag.sessionId !== undefined) {
      if (options.requireSessionId && !matchedFlag.sessionId) {
        continue;
      }
      return {
        flag: matchedFlag.flag,
        sessionId: matchedFlag.sessionId
      };
    }

    const nextToken = argv[index + 1]?.trim();
    const sessionId = nextToken && !nextToken.startsWith('-') ? nextToken : undefined;
    if (options.requireSessionId && !sessionId) {
      continue;
    }
    return {
      flag: matchedFlag.flag,
      sessionId
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
  errorDescriptor?: AgentLaunchMessageDescriptor;
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
    const errorDescriptor: AgentLaunchMessageDescriptor = {
      id: quote === 'double' ? 'doubleQuoteUnclosed' : 'singleQuoteUnclosed'
    };
    return {
      argv: [],
      error: formatAgentLaunchMessageDescriptor(errorDescriptor),
      errorDescriptor
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
        ? ['--dangerously-skip-permissions', ...baseArgs]
        : ['--yolo', ...baseArgs];
    case 'sandbox':
      return provider === 'claude'
        ? ['--permission-mode', 'plan', ...baseArgs]
        : ['--sandbox', 'workspace-write', ...baseArgs];
    case 'custom':
    case 'default':
    default:
      return [...baseArgs];
  }
}

function resolveAgentResumeForkBaseArgs(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  launchIntent?: AgentLaunchIntentOptions
): string[] {
  const defaultArgs = assertAgentDefaultArgsParsable(provider, defaults);
  if (!launchIntent) {
    return defaultArgs;
  }

  const launchPreset = launchIntent.launchPreset ?? 'default';
  const intentArgs = resolveAgentLaunchIntentArgs(provider, defaults, launchIntent);
  return mergeAgentLaunchIntentWithDefaultArgs(provider, defaultArgs, intentArgs, launchPreset);
}

function resolveAgentLaunchIntentArgs(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  launchIntent: AgentLaunchIntentOptions
): string[] {
  const launchPreset = launchIntent.launchPreset ?? 'default';
  if (launchIntent.templateArgv !== undefined) {
    return [...launchIntent.templateArgv];
  }

  if (launchPreset === 'custom') {
    const customLaunchCommand = launchIntent.customLaunchCommand?.trim();
    if (!customLaunchCommand) {
      return [];
    }

    const validation = validateAgentCommandLine(customLaunchCommand, provider, defaults);
    if (!validation.valid || !validation.parsed) {
      throw new AgentLaunchPresetError(validation.errorDescriptor ?? { id: 'launchCommandEmpty' });
    }
    return validation.parsed.args;
  }

  if (launchPreset === 'yolo') {
    return provider === 'claude' ? ['--dangerously-skip-permissions'] : ['--yolo'];
  }

  if (launchPreset === 'sandbox') {
    return provider === 'claude' ? ['--permission-mode', 'plan'] : ['--sandbox', 'workspace-write'];
  }

  return [];
}

function mergeAgentLaunchIntentWithDefaultArgs(
  provider: AgentProviderKind,
  defaultArgs: readonly string[],
  intentArgs: readonly string[],
  launchPreset: AgentLaunchPresetKind
): string[] {
  if (intentArgs.length === 0) {
    return [...defaultArgs];
  }

  const cleanedIntentArgs = stripProviderSessionTargetArgs(provider, intentArgs);
  if (cleanedIntentArgs.length === 0) {
    return [...defaultArgs];
  }
  const normalizedDefaultArgs = stripDefaultArgsConflictingWithIntent(provider, defaultArgs, cleanedIntentArgs);

  if (launchPreset === 'default' || launchPreset === 'custom') {
    return [...normalizedDefaultArgs, ...cleanedIntentArgs];
  }

  return [...cleanedIntentArgs, ...normalizedDefaultArgs];
}

function stripProviderSessionTargetArgs(provider: AgentProviderKind, args: readonly string[]): string[] {
  return provider === 'claude' ? stripClaudeResumeTargetArgs(args) : stripCodexResumeForkTargetArgs(args);
}

function stripDefaultArgsConflictingWithIntent(
  provider: AgentProviderKind,
  defaultArgs: readonly string[],
  intentArgs: readonly string[]
): string[] {
  const conflictKeys = collectAgentLaunchIntentConflictKeys(provider, intentArgs);
  if (conflictKeys.size === 0) {
    return [...defaultArgs];
  }

  return provider === 'claude'
    ? stripClaudeArgsByConflictKeys(defaultArgs, conflictKeys)
    : stripCodexArgsByConflictKeys(defaultArgs, conflictKeys);
}

function collectAgentLaunchIntentConflictKeys(
  provider: AgentProviderKind,
  args: readonly string[]
): Set<AgentLaunchArgConflictKey> {
  const conflictKeys = new Set<AgentLaunchArgConflictKey>();
  for (const token of args) {
    const conflictKey = provider === 'claude'
      ? getClaudeArgConflictKey(token)
      : getCodexArgConflictKey(token);
    if (conflictKey) {
      conflictKeys.add(conflictKey);
    }
  }

  return conflictKeys;
}

function stripCodexArgsByConflictKeys(
  args: readonly string[],
  conflictKeys: ReadonlySet<AgentLaunchArgConflictKey>
): string[] {
  const normalizedArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const conflictKey = getCodexArgConflictKey(token);
    if (conflictKey && conflictKeys.has(conflictKey)) {
      if (codexConflictArgConsumesFollowingValue(token)) {
        index = skipOwnedFlagValue(args, index);
      }
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

function stripClaudeArgsByConflictKeys(
  args: readonly string[],
  conflictKeys: ReadonlySet<AgentLaunchArgConflictKey>
): string[] {
  const normalizedArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const conflictKey = getClaudeArgConflictKey(token);
    if (conflictKey && conflictKeys.has(conflictKey)) {
      if (claudeConflictArgConsumesFollowingValue(token)) {
        index = skipOwnedFlagValue(args, index);
      }
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

function getCodexArgConflictKey(token: string): AgentLaunchArgConflictKey | undefined {
  if (
    token === '--yolo' ||
    token === '--full-auto' ||
    token === '--dangerously-bypass-approvals-and-sandbox' ||
    token === '--sandbox' ||
    token === '-s' ||
    token === '--ask-for-approval' ||
    token === '-a' ||
    token.startsWith('--sandbox=') ||
    token.startsWith('-s=') ||
    token.startsWith('--ask-for-approval=') ||
    token.startsWith('-a=')
  ) {
    return 'codex-execution-mode';
  }

  if (token === '--model' || token === '-m' || token.startsWith('--model=') || token.startsWith('-m=')) {
    return 'codex-model';
  }

  if (token === '--profile' || token === '-p' || token.startsWith('--profile=') || token.startsWith('-p=')) {
    return 'codex-profile';
  }

  if (token === '--cd' || token === '-C' || token.startsWith('--cd=') || token.startsWith('-C=')) {
    return 'codex-cwd';
  }

  if (token === '--local-provider' || token.startsWith('--local-provider=')) {
    return 'codex-local-provider';
  }

  return undefined;
}

function getClaudeArgConflictKey(token: string): AgentLaunchArgConflictKey | undefined {
  if (
    token === '--dangerously-skip-permissions' ||
    token === '--permission-mode' ||
    token.startsWith('--permission-mode=')
  ) {
    return 'claude-execution-mode';
  }

  if (token === '--model' || token.startsWith('--model=')) {
    return 'claude-model';
  }

  return undefined;
}

function codexConflictArgConsumesFollowingValue(token: string): boolean {
  return (
    token === '--sandbox' ||
    token === '-s' ||
    token === '--ask-for-approval' ||
    token === '-a' ||
    token === '--model' ||
    token === '-m' ||
    token === '--profile' ||
    token === '-p' ||
    token === '--cd' ||
    token === '-C' ||
    token === '--local-provider'
  );
}

function claudeConflictArgConsumesFollowingValue(token: string): boolean {
  return token === '--permission-mode' || token === '--model';
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
      ? ['--resume', explicitSessionId, ...normalizedArgs]
      : ['--resume', ...normalizedArgs];
  }

  return buildCodexResumeArgv(baseArgs, explicitSessionId);
}

function buildCodexBranchArgv(baseArgs: readonly string[], explicitSessionId: string): string[] {
  const { leadingArgs, subcommandArgs } = splitCodexSessionSubcommandArgs(baseArgs, ['fork', 'resume']);
  const normalizedLeadingArgs = stripCodexForkSelectionArgs(leadingArgs);
  const normalizedSubcommandArgs = subcommandArgs ? stripCodexForkSelectionArgs(subcommandArgs) : [];
  return ['fork', ...normalizedLeadingArgs, ...normalizedSubcommandArgs, explicitSessionId];
}

function buildClaudeBranchArgv(baseArgs: readonly string[], explicitSessionId: string): string[] {
  const normalizedArgs = stripClaudeResumeTargetArgs(baseArgs);
  return ['--resume', explicitSessionId, '--fork-session', ...normalizedArgs];
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
  const stripOptions = {
    explicitTarget: explicitSessionId !== undefined
  };
  const normalizedLeadingArgs = stripCodexResumeSelectionArgs(leadingArgs, stripOptions);
  const normalizedResumeArgs = resumeArgs
    ? stripCodexResumeSelectionArgs(resumeArgs, stripOptions)
    : [];
  return explicitSessionId
    ? ['resume', ...normalizedLeadingArgs, ...normalizedResumeArgs, explicitSessionId]
    : ['resume', ...normalizedLeadingArgs, ...normalizedResumeArgs];
}

function splitCodexResumeArgs(baseArgs: readonly string[]): {
  leadingArgs: string[];
  resumeArgs?: string[];
} {
  const splitArgs = splitCodexSessionSubcommandArgs(baseArgs, ['resume']);
  return {
    leadingArgs: splitArgs.leadingArgs,
    resumeArgs: splitArgs.subcommandArgs
  };
}

function splitCodexSessionSubcommandArgs(baseArgs: readonly string[], subcommands: readonly string[]): {
  leadingArgs: string[];
  subcommandArgs?: string[];
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

    if (!encounteredPositional && subcommands.includes(token)) {
      return {
        leadingArgs: [...baseArgs.slice(0, index)],
        subcommandArgs: [...baseArgs.slice(index + 1)]
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

function findCodexSessionSubcommandIndex(baseArgs: readonly string[], subcommands: readonly string[]): number {
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

    if (!encounteredPositional && subcommands.includes(token)) {
      return index;
    }

    if (codexOptionConsumesFollowingValue(token)) {
      nextTokenIsOptionValue = true;
      continue;
    }

    if (!encounteredPositional && !isOptionLikeCommandToken(token)) {
      encounteredPositional = true;
    }
  }

  return -1;
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

function stripCodexResumeForkTargetArgs(args: readonly string[]): string[] {
  const { leadingArgs, subcommandArgs } = splitCodexSessionSubcommandArgs(args, ['fork', 'resume']);
  return [
    ...stripCodexForkSelectionArgs(leadingArgs),
    ...(subcommandArgs ? stripCodexForkSelectionArgs(subcommandArgs) : [])
  ];
}

function stripCodexForkSelectionArgs(forkArgs: readonly string[]): string[] {
  const normalizedArgs: string[] = [];
  let nextTokenIsOptionValue = false;

  for (let index = 0; index < forkArgs.length; index += 1) {
    const token = forkArgs[index];

    if (nextTokenIsOptionValue) {
      normalizedArgs.push(token);
      nextTokenIsOptionValue = false;
      continue;
    }

    if (token === '--') {
      break;
    }

    if (isCodexSessionSelectionFlag(token)) {
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
      token === '--fork-session' ||
      token.startsWith('--fork-session=') ||
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
  if (nextToken !== undefined && !isOptionLikeCommandToken(nextToken)) {
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
    normalizeComparableArgv(inputArgs, provider) === normalizeComparableArgv(presetArgs, provider)
  );
}

function normalizeComparableArgv(argv: readonly string[], provider: AgentProviderKind): string {
  return JSON.stringify(
    provider === 'claude' ? canonicalizeClaudeComparableArgv(argv) : canonicalizeCodexComparableArgv(argv)
  );
}

function canonicalizeCodexComparableArgv(argv: readonly string[]): string[] {
  const resumeTokenIndex = argv.indexOf('resume');
  const resumeToken = resumeTokenIndex >= 0 ? argv[resumeTokenIndex] : undefined;
  const argvWithoutResume = resumeTokenIndex >= 0 ? argv.filter((_, index) => index !== resumeTokenIndex) : [...argv];
  const extracted: string[] = [];
  const remaining: string[] = [];

  for (let index = 0; index < argvWithoutResume.length; index += 1) {
    const token = argvWithoutResume[index];

    if (
      token === '--yolo' ||
      token === '--full-auto' ||
      token === '--dangerously-bypass-approvals-and-sandbox' ||
      token.startsWith('-s=') ||
      token.startsWith('-a=') ||
      token.startsWith('--sandbox=') ||
      token.startsWith('--ask-for-approval=')
    ) {
      extracted.push(token);
      continue;
    }

    if (token === '--sandbox' || token === '-s' || token === '--ask-for-approval' || token === '-a') {
      extracted.push(token);
      const nextToken = argvWithoutResume[index + 1];
      if (nextToken && !isOptionLikeCommandToken(nextToken)) {
        extracted.push(nextToken);
        index += 1;
      }
      continue;
    }

    remaining.push(token);
  }

  return [...(resumeToken ? [resumeToken] : []), ...extracted, ...remaining];
}

function canonicalizeClaudeComparableArgv(argv: readonly string[]): string[] {
  const resumeTokenIndex = argv.findIndex((token) => token === '--resume' || token === '-r');
  const resumeToken = resumeTokenIndex >= 0 ? argv[resumeTokenIndex] : undefined;
  const argvWithoutResume = resumeTokenIndex >= 0 ? argv.filter((_, index) => index !== resumeTokenIndex) : [...argv];
  const extracted: string[] = [];
  const remaining: string[] = [];

  for (let index = 0; index < argvWithoutResume.length; index += 1) {
    const token = argvWithoutResume[index];

    if (token === '--dangerously-skip-permissions' || token.startsWith('--permission-mode=')) {
      extracted.push(token);
      continue;
    }

    if (token === '--permission-mode') {
      extracted.push(token);
      const nextToken = argvWithoutResume[index + 1];
      if (nextToken && !isOptionLikeCommandToken(nextToken)) {
        extracted.push(nextToken);
        index += 1;
      }
      continue;
    }

    remaining.push(token);
  }

  return [...(resumeToken ? [resumeToken] : []), ...extracted, ...remaining];
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
  errorDescriptor?: AgentLaunchMessageDescriptor;
} {
  const parsed = parseCommandLine(defaults.defaultArgs);
  if (parsed.error) {
    const errorDescriptor: AgentLaunchMessageDescriptor = {
      id: 'defaultArgsParseError',
      params: {
        provider: providerLabel(provider),
        message: parsed.error
      },
      cause: parsed.errorDescriptor
    };
    return {
      error: formatAgentLaunchMessageDescriptor(errorDescriptor),
      errorDescriptor
    };
  }

  const conflict = findAgentDefaultArgsConflict(provider, parsed.argv);
  if (conflict) {
    const token = quoteCommandToken(conflict.token);
    const errorDescriptor: AgentLaunchMessageDescriptor = {
      id: 'defaultArgsConflict',
      params: {
        provider: providerLabel(provider),
        descriptionId: conflict.descriptionId,
        token
      }
    };
    return {
      error: formatAgentLaunchMessageDescriptor(errorDescriptor),
      errorDescriptor
    };
  }

  return {
    args: parsed.argv
  };
}

function findAgentDefaultArgsConflict(
  provider: AgentProviderKind,
  args: readonly string[]
): AgentDefaultArgsConflict | undefined {
  return provider === 'claude'
    ? findClaudeDefaultArgsConflict(args)
    : findCodexDefaultArgsConflict(args);
}

function findCodexDefaultArgsConflict(args: readonly string[]): AgentDefaultArgsConflict | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--') {
      return {
        token,
        descriptionId: 'positionalArgumentSeparator'
      };
    }

    if (isCodexSessionSelectionFlag(token)) {
      return {
        token,
        descriptionId: 'sessionSelectionArgument'
      };
    }

    if (!isOptionLikeCommandToken(token)) {
      return {
        token,
        descriptionId: token === 'resume' || token === 'fork'
          ? 'sessionTargetSubcommand'
          : 'positionalArgument'
      };
    }

    if (codexOptionConsumesFollowingValue(token)) {
      index = skipOwnedFlagValue(args, index);
      continue;
    }
  }

  return undefined;
}

function isCodexSessionSelectionFlag(token: string): boolean {
  return (
    token === '--last' ||
    token === '--all' ||
    token === '--include-non-interactive' ||
    token.startsWith('--last=') ||
    token.startsWith('--all=') ||
    token.startsWith('--include-non-interactive=')
  );
}

function findClaudeDefaultArgsConflict(args: readonly string[]): AgentDefaultArgsConflict | undefined {
  for (const token of args) {
    if (token === '--fork-session' || token.startsWith('--fork-session=')) {
      return {
        token,
        descriptionId: 'forkFlagArgument'
      };
    }

    if (matchClaudeCommandSessionFlag(token)) {
      return {
        token,
        descriptionId: 'sessionTargetArgument'
      };
    }
  }

  return undefined;
}

function getAgentDefaultArgsParseErrorDescriptor(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): AgentLaunchMessageDescriptor | undefined {
  return parseAgentDefaultArgs(provider, defaults).errorDescriptor;
}

function assertAgentDefaultArgsParsable(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults
): string[] {
  const parsed = parseAgentDefaultArgs(provider, defaults);
  if (parsed.errorDescriptor) {
    throw new AgentLaunchPresetError(parsed.errorDescriptor);
  }

  return parsed.args ?? [];
}

function providerLabel(provider: AgentProviderKind): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex';
}

function invalidAgentCommandValidationResult(
  descriptor: AgentLaunchMessageDescriptor
): AgentCommandValidationResult {
  return {
    valid: false,
    error: formatAgentLaunchMessageDescriptor(descriptor),
    errorDescriptor: descriptor
  };
}

function isAgentLaunchMessageDescriptor(value: unknown): value is AgentLaunchMessageDescriptor {
  return isRecord(value) && typeof value.id === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
