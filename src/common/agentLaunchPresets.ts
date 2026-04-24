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

const WINDOWS_EXECUTABLE_SUFFIX = /\.(exe|cmd|bat|com)$/i;

export function buildAgentPresetCommandLine(
  provider: AgentProviderKind,
  defaults: AgentProviderLaunchDefaults,
  preset: AgentLaunchPresetKind
): string {
  const baseArgs = parseCommandLine(defaults.defaultArgs).argv;
  const command = defaults.command.trim() || provider;
  const argv = [command, ...applyAgentPresetArgs(provider, baseArgs, preset)];
  return formatCommandLine(argv);
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
  const normalizedInput = normalizeComparableCommandLine(commandLine);
  if (!normalizedInput) {
    return {
      launchPreset: 'default'
    };
  }

  for (const preset of ['default', 'resume', 'yolo', 'sandbox'] as const) {
    if (normalizedInput === normalizeComparableCommandLine(buildAgentPresetCommandLine(provider, defaults, preset))) {
      return {
        launchPreset: preset
      };
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

  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/([\\"])|\n/g, (match, escaped) => {
    if (match === '\n') {
      return '\\n';
    }
    return `\\${escaped}`;
  })}"`;
}

export function parseCommandLine(commandLine: string): {
  argv: string[];
  error?: string;
} {
  const argv: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | undefined;
  let escaping = false;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];

    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\' && quote !== 'single') {
      escaping = true;
      continue;
    }

    if (character === '"') {
      if (quote === 'double') {
        quote = undefined;
      } else if (!quote) {
        quote = 'double';
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'") {
      if (quote === 'single') {
        quote = undefined;
      } else if (!quote) {
        quote = 'single';
      } else {
        current += character;
      }
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (current) {
        argv.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    return {
      argv: [],
      error: quote === 'double' ? '双引号未闭合。' : '单引号未闭合。'
    };
  }

  if (current) {
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

function isProviderCommandMatch(
  candidateCommand: string,
  provider: AgentProviderKind,
  configuredCommand: string
): boolean {
  const candidateIdentity = normalizeCommandIdentity(candidateCommand);
  if (!candidateIdentity) {
    return false;
  }

  const configuredIdentity = normalizeCommandIdentity(configuredCommand);
  const providerIdentity = normalizeCommandIdentity(provider);
  return candidateIdentity === configuredIdentity || candidateIdentity === providerIdentity;
}

function normalizeComparableCommandLine(commandLine: string): string {
  const parsed = parseCommandLine(commandLine);
  return parsed.argv.join('\u0000').trim();
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
