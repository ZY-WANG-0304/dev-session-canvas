import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-launch-presets-'));

try {
  const outfile = path.join(tempDir, 'agentLaunchPresets.cjs');

  await esbuild.build({
    entryPoints: [path.resolve('src/common/agentLaunchPresets.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    buildAgentPresetCommandLine,
    buildFreshAgentCommandLine,
    buildAgentHistoryResumeCommandLine,
    classifyAgentLaunchPreset,
    extractClaudeCommandSessionFlag,
    formatCommandLine,
    hasAnyCommandLineFlag,
    matchesAgentCommandLinePreset,
    parseCommandLine,
    validateAgentCommandLine
  } = require(outfile);

  const claudeDefaults = {
    command: '/tmp/providers/claude-custom',
    defaultArgs: ''
  };

  const aliasValidation = validateAgentCommandLine(
    'claude --resume=session-123',
    'claude',
    claudeDefaults
  );
  assert.equal(aliasValidation.valid, true);
  assert.equal(aliasValidation.parsed.command, 'claude');
  assert.deepEqual(aliasValidation.parsed.args, ['--resume=session-123']);

  const configuredCommandValidation = validateAgentCommandLine(
    '/tmp/providers/claude-custom --session-id=session-456',
    'claude',
    claudeDefaults
  );
  assert.equal(configuredCommandValidation.valid, true);
  assert.equal(configuredCommandValidation.parsed.command, '/tmp/providers/claude-custom');
  assert.deepEqual(configuredCommandValidation.parsed.args, ['--session-id=session-456']);

  const basenameOnlyPathValidation = validateAgentCommandLine(
    '/tmp/evil/claude --resume=session-456',
    'claude',
    {
      command: '/usr/local/bin/claude',
      defaultArgs: ''
    }
  );
  assert.equal(basenameOnlyPathValidation.valid, false);
  assert.equal(basenameOnlyPathValidation.error, '命令必须以当前 Claude Code 命令或 claude 开头。');

  const invalidProviderValidation = validateAgentCommandLine(
    'node -e "process.stdout.write(\'provider-bypass\')"',
    'claude',
    claudeDefaults
  );
  assert.equal(invalidProviderValidation.valid, false);
  assert.equal(invalidProviderValidation.error, '命令必须以当前 Claude Code 命令或 claude 开头。');

  const windowsCodexValidation = validateAgentCommandLine(
    'C:\\tools\\codex.exe --yolo',
    'codex',
    {
      command: 'C:\\tools\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(windowsCodexValidation.valid, true);
  assert.equal(windowsCodexValidation.parsed.command, 'C:\\tools\\codex.exe');
  assert.deepEqual(windowsCodexValidation.parsed.args, ['--yolo']);

  const quotedWindowsCodexValidation = validateAgentCommandLine(
    '"C:\\Program Files\\Codex\\codex.exe" --yolo',
    'codex',
    {
      command: 'C:\\Program Files\\Codex\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(quotedWindowsCodexValidation.valid, true);
  assert.equal(quotedWindowsCodexValidation.parsed.command, 'C:\\Program Files\\Codex\\codex.exe');
  assert.deepEqual(quotedWindowsCodexValidation.parsed.args, ['--yolo']);

  const legacyQuotedWindowsCodexValidation = validateAgentCommandLine(
    '"C:\\\\Program Files\\\\Codex\\\\codex.exe" --yolo',
    'codex',
    {
      command: 'C:\\Program Files\\Codex\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(legacyQuotedWindowsCodexValidation.valid, true);
  assert.equal(legacyQuotedWindowsCodexValidation.parsed.command, 'C:\\Program Files\\Codex\\codex.exe');
  assert.deepEqual(legacyQuotedWindowsCodexValidation.parsed.args, ['--yolo']);

  const windowsPresetCommandLine = buildAgentPresetCommandLine(
    'codex',
    {
      command: 'C:\\Program Files\\Codex\\codex.exe',
      defaultArgs: '--yolo'
    },
    'default'
  );
  assert.equal(windowsPresetCommandLine, "'C:\\Program Files\\Codex\\codex.exe' --yolo");

  assert.equal(formatCommandLine(['codex', '--foo', '']), 'codex --foo ""');
  assert.deepEqual(parseCommandLine('codex --foo ""'), {
    argv: ['codex', '--foo', '']
  });
  assert.deepEqual(parseCommandLine('""'), {
    argv: ['']
  });
  assert.deepEqual(
    classifyAgentLaunchPreset(
      'codex',
      'codex --foo ""',
      {
        command: 'codex',
        defaultArgs: '--foo ""'
      }
    ),
    {
      launchPreset: 'default'
    }
  );

  const configuredCodexDefaults = {
    command: '/opt/codex/bin/codex',
    defaultArgs: ''
  };
  const configuredCodexAliasValidation = validateAgentCommandLine(
    'codex --yolo',
    'codex',
    configuredCodexDefaults
  );
  assert.equal(configuredCodexAliasValidation.valid, true);
  assert.equal(configuredCodexAliasValidation.parsed.command, 'codex');
  assert.deepEqual(configuredCodexAliasValidation.parsed.args, ['--yolo']);
  assert.deepEqual(
    classifyAgentLaunchPreset(
      'codex',
      'codex --yolo',
      configuredCodexDefaults
    ),
    {
      launchPreset: 'yolo'
    }
  );

  const codexModeConflictDefaults = {
    command: 'codex',
    defaultArgs: '--model gpt-5.2 --sandbox danger-full-access'
  };
  assert.equal(
    buildAgentPresetCommandLine('codex', codexModeConflictDefaults, 'yolo'),
    'codex --model gpt-5.2 --yolo'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: 'resume --last'
      },
      'yolo'
    ),
    'codex resume --last --yolo'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 resume session-123'
      },
      'yolo'
    ),
    'codex --model gpt-5.2 resume session-123 --yolo'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --sandbox workspace-write --ask-for-approval on-request'
      },
      'yolo'
    ),
    'codex --model gpt-5.2 --yolo'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 -s=workspace-write -a=on-request'
      },
      'yolo'
    ),
    'codex --model gpt-5.2 --yolo'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: 'resume --last'
      },
      'resume'
    ),
    'codex resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: 'resume --last --sandbox workspace-write'
      },
      'resume'
    ),
    'codex resume --sandbox workspace-write'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 resume session-123'
      },
      'resume'
    ),
    'codex --model gpt-5.2 resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 resume --all --include-non-interactive session-123 --sandbox workspace-write'
      },
      'resume'
    ),
    'codex --model gpt-5.2 resume --all --include-non-interactive --sandbox workspace-write'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--local-provider ollama resume --last'
      },
      'resume'
    ),
    'codex --local-provider ollama resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --yolo'
      },
      'sandbox'
    ),
    'codex --model gpt-5.2 --sandbox workspace-write'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --full-auto'
      },
      'sandbox'
    ),
    'codex --model gpt-5.2 --sandbox workspace-write'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --dangerously-bypass-approvals-and-sandbox'
      },
      'sandbox'
    ),
    'codex --model gpt-5.2 --sandbox workspace-write'
  );

  const claudeModeConflictDefaults = {
    command: 'claude',
    defaultArgs: '--model sonnet --permission-mode acceptEdits'
  };
  assert.equal(
    buildAgentPresetCommandLine('claude', claudeModeConflictDefaults, 'yolo'),
    'claude --model sonnet --dangerously-skip-permissions'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '--model sonnet --resume session-123 --permission-mode acceptEdits'
      },
      'yolo'
    ),
    'claude --model sonnet --resume session-123 --dangerously-skip-permissions'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '--model sonnet --continue session-123 --dangerously-skip-permissions'
      },
      'sandbox'
    ),
    'claude --model sonnet --continue session-123 --permission-mode plan'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '--model sonnet --resume session-123'
      },
      'resume'
    ),
    'claude --model sonnet --resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '-r session-123'
      },
      'resume'
    ),
    'claude --resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '-c'
      },
      'resume'
    ),
    'claude --resume'
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'claude',
      {
        command: 'claude',
        defaultArgs: '--model sonnet --dangerously-skip-permissions'
      },
      'sandbox'
    ),
    'claude --model sonnet --permission-mode plan'
  );
  assert.equal(
    matchesAgentCommandLinePreset(
      'codex',
      'codex --model gpt-5.2 --yolo',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --yolo'
      },
      'default'
    ),
    true
  );
  assert.equal(
    matchesAgentCommandLinePreset(
      'codex',
      'codex --model gpt-5.2 --yolo',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --yolo'
      },
      'yolo'
    ),
    true
  );
  assert.deepEqual(
    classifyAgentLaunchPreset(
      'codex',
      'codex --model gpt-5.2 --yolo',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 --yolo'
      }
    ),
    {
      launchPreset: 'default'
    }
  );

  const trailingSlashConfigPath = 'C:\\Users\\me\\My Dir\\';
  const formattedTrailingSlashCommandLine = formatCommandLine(['codex', '--config', trailingSlashConfigPath]);
  assert.equal(formattedTrailingSlashCommandLine, "codex --config 'C:\\Users\\me\\My Dir\\'");
  assert.deepEqual(parseCommandLine(formattedTrailingSlashCommandLine), {
    argv: ['codex', '--config', trailingSlashConfigPath]
  });
  assert.deepEqual(parseCommandLine('codex --config "C:\\\\Users\\\\me\\\\My Dir\\\\"'), {
    argv: ['codex', '--config', trailingSlashConfigPath]
  });

  const naturalTrailingSlashCommandLine = 'codex --config "C:\\Users\\me\\My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalTrailingSlashCommandLine), {
    argv: ['codex', '--config', trailingSlashConfigPath]
  });
  const naturalTrailingSlashValidation = validateAgentCommandLine(
    naturalTrailingSlashCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalTrailingSlashValidation.valid, true);
  assert.equal(naturalTrailingSlashValidation.parsed.command, 'codex');
  assert.deepEqual(naturalTrailingSlashValidation.parsed.args, ['--config', trailingSlashConfigPath]);

  const presetFromNaturalWindowsArgs = buildAgentPresetCommandLine(
    'codex',
    {
      command: 'codex',
      defaultArgs: '--config "C:\\Users\\me\\My Dir\\"'
    },
    'default'
  );
  assert.equal(presetFromNaturalWindowsArgs, "codex --config 'C:\\Users\\me\\My Dir\\'");

  const uncConfigPath = '\\\\server\\share\\My Dir\\';
  const formattedUncCommandLine = formatCommandLine(['codex', '--config', uncConfigPath]);
  assert.equal(formattedUncCommandLine, "codex --config '\\\\server\\share\\My Dir\\'");
  assert.deepEqual(parseCommandLine(formattedUncCommandLine), {
    argv: ['codex', '--config', uncConfigPath]
  });
  assert.deepEqual(parseCommandLine('codex --config "\\\\\\\\server\\\\share\\\\My Dir\\\\"'), {
    argv: ['codex', '--config', uncConfigPath]
  });
  const naturalUncCommandLine = 'codex --config "\\\\server\\share\\My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalUncCommandLine), {
    argv: ['codex', '--config', uncConfigPath]
  });
  const spacedUncConfigPath = '\\\\server\\My Share\\My Dir\\';
  const naturalSpacedUncCommandLine = 'codex --config "\\\\server\\My Share\\My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalSpacedUncCommandLine), {
    argv: ['codex', '--config', spacedUncConfigPath]
  });
  const naturalSpacedUncValidation = validateAgentCommandLine(
    naturalSpacedUncCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalSpacedUncValidation.valid, true);
  assert.equal(naturalSpacedUncValidation.parsed.command, 'codex');
  assert.deepEqual(naturalSpacedUncValidation.parsed.args, ['--config', spacedUncConfigPath]);
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--config "\\\\server\\My Share\\My Dir\\"'
      },
      'default'
    ),
    "codex --config '\\\\server\\My Share\\My Dir\\'"
  );
  const naturalUncValidation = validateAgentCommandLine(
    '"\\\\server\\share\\Codex\\codex.exe" --yolo',
    'codex',
    {
      command: '\\\\server\\share\\Codex\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(naturalUncValidation.valid, true);
  assert.equal(naturalUncValidation.parsed.command, '\\\\server\\share\\Codex\\codex.exe');
  assert.deepEqual(naturalUncValidation.parsed.args, ['--yolo']);
  const legacyUncValidation = validateAgentCommandLine(
    '"\\\\\\\\server\\\\share\\\\Codex\\\\codex.exe" --yolo',
    'codex',
    {
      command: '\\\\server\\share\\Codex\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(legacyUncValidation.valid, true);
  assert.equal(legacyUncValidation.parsed.command, '\\\\server\\share\\Codex\\codex.exe');
  assert.deepEqual(legacyUncValidation.parsed.args, ['--yolo']);

  const relativeTrailingSlashConfigPath = 'My Dir\\';
  const naturalRelativeTrailingSlashCommandLine = 'codex --config "My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalRelativeTrailingSlashCommandLine), {
    argv: ['codex', '--config', relativeTrailingSlashConfigPath]
  });
  const naturalRelativeTrailingSlashPositionalCommandLine = 'codex "My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalRelativeTrailingSlashPositionalCommandLine), {
    argv: ['codex', relativeTrailingSlashConfigPath]
  });
  const naturalRelativeTrailingSlashPositionalValidation = validateAgentCommandLine(
    naturalRelativeTrailingSlashPositionalCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalRelativeTrailingSlashPositionalValidation.valid, true);
  assert.equal(naturalRelativeTrailingSlashPositionalValidation.parsed.command, 'codex');
  assert.deepEqual(naturalRelativeTrailingSlashPositionalValidation.parsed.args, [relativeTrailingSlashConfigPath]);
  const naturalRelativeTrailingSlashValidation = validateAgentCommandLine(
    naturalRelativeTrailingSlashCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalRelativeTrailingSlashValidation.valid, true);
  assert.equal(naturalRelativeTrailingSlashValidation.parsed.command, 'codex');
  assert.deepEqual(naturalRelativeTrailingSlashValidation.parsed.args, ['--config', relativeTrailingSlashConfigPath]);
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--config "My Dir\\"'
      },
      'default'
    ),
    "codex --config 'My Dir\\'"
  );
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '"My Dir\\"'
      },
      'default'
    ),
    "codex 'My Dir\\'"
  );
  const relativeTrailingSlashNoSpaceConfigPath = '.venv\\';
  const naturalRelativeTrailingSlashNoSpaceCommandLine = 'codex --config ".venv\\"';
  assert.deepEqual(parseCommandLine(naturalRelativeTrailingSlashNoSpaceCommandLine), {
    argv: ['codex', '--config', relativeTrailingSlashNoSpaceConfigPath]
  });
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--config ".venv\\"'
      },
      'default'
    ),
    'codex --config .venv\\'
  );
  const naturalRelativeTrailingSlashNoSpaceValidation = validateAgentCommandLine(
    naturalRelativeTrailingSlashNoSpaceCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalRelativeTrailingSlashNoSpaceValidation.valid, true);
  assert.equal(naturalRelativeTrailingSlashNoSpaceValidation.parsed.command, 'codex');
  assert.deepEqual(naturalRelativeTrailingSlashNoSpaceValidation.parsed.args, ['--config', relativeTrailingSlashNoSpaceConfigPath]);
  const relativeTrailingSlashNoSpacePositionalPath = 'build\\';
  const naturalRelativeTrailingSlashNoSpacePositionalCommandLine = 'codex "build\\"';
  assert.deepEqual(parseCommandLine(naturalRelativeTrailingSlashNoSpacePositionalCommandLine), {
    argv: ['codex', relativeTrailingSlashNoSpacePositionalPath]
  });
  const naturalRelativeTrailingSlashNoSpacePositionalValidation = validateAgentCommandLine(
    naturalRelativeTrailingSlashNoSpacePositionalCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(naturalRelativeTrailingSlashNoSpacePositionalValidation.valid, true);
  assert.equal(naturalRelativeTrailingSlashNoSpacePositionalValidation.parsed.command, 'codex');
  assert.deepEqual(naturalRelativeTrailingSlashNoSpacePositionalValidation.parsed.args, [relativeTrailingSlashNoSpacePositionalPath]);
  const bracketedRelativeTrailingSlashConfigPath = '[Draft] Dir\\';
  const bracketedRelativeTrailingSlashCommandLine = 'codex --config "[Draft] Dir\\"';
  assert.deepEqual(parseCommandLine(bracketedRelativeTrailingSlashCommandLine), {
    argv: ['codex', '--config', bracketedRelativeTrailingSlashConfigPath]
  });
  assert.deepEqual(parseCommandLine('codex "[Draft] Dir\\"'), {
    argv: ['codex', bracketedRelativeTrailingSlashConfigPath]
  });
  const ampersandRelativeTrailingSlashConfigPath = 'R&D Dir\\';
  const ampersandRelativeTrailingSlashCommandLine = 'codex --config "R&D Dir\\"';
  assert.deepEqual(parseCommandLine(ampersandRelativeTrailingSlashCommandLine), {
    argv: ['codex', '--config', ampersandRelativeTrailingSlashConfigPath]
  });
  assert.deepEqual(parseCommandLine('codex "R&D Dir\\"'), {
    argv: ['codex', ampersandRelativeTrailingSlashConfigPath]
  });
  assert.deepEqual(parseCommandLine('codex --config="[Draft] Dir\\"'), {
    argv: ['codex', '--config=[Draft] Dir\\']
  });
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--config "[Draft] Dir\\"'
      },
      'default'
    ),
    "codex --config '[Draft] Dir\\'"
  );

  const driveRelativeTrailingSlashConfigPath = 'C:My Dir\\';
  const naturalDriveRelativeTrailingSlashCommandLine = 'codex --config "C:My Dir\\"';
  assert.deepEqual(parseCommandLine(naturalDriveRelativeTrailingSlashCommandLine), {
    argv: ['codex', '--config', driveRelativeTrailingSlashConfigPath]
  });
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: '--config "C:My Dir\\"'
      },
      'default'
    ),
    "codex --config 'C:My Dir\\'"
  );

  const escapedPromptToken = '\\" a';
  const escapedPromptCommandLine = String.raw`codex --prompt "\\\" a"`;
  assert.deepEqual(parseCommandLine(escapedPromptCommandLine), {
    argv: ['codex', '--prompt', escapedPromptToken]
  });
  const escapedPromptValidation = validateAgentCommandLine(
    escapedPromptCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(escapedPromptValidation.valid, true);
  assert.equal(escapedPromptValidation.parsed.command, 'codex');
  assert.deepEqual(escapedPromptValidation.parsed.args, ['--prompt', escapedPromptToken]);

  const escapedPromptPresetCommandLine = buildAgentPresetCommandLine(
    'codex',
    {
      command: 'codex',
      defaultArgs: String.raw`--prompt '\" a'`
    },
    'default'
  );
  assert.equal(escapedPromptPresetCommandLine, String.raw`codex --prompt '\" a'`);
  const escapedPromptPresetValidation = validateAgentCommandLine(
    escapedPromptPresetCommandLine,
    'codex',
    {
      command: 'codex',
      defaultArgs: ''
    }
  );
  assert.equal(escapedPromptPresetValidation.valid, true);
  assert.equal(escapedPromptPresetValidation.parsed.command, 'codex');
  assert.deepEqual(escapedPromptPresetValidation.parsed.args, ['--prompt', escapedPromptToken]);

  assert.deepEqual(parseCommandLine('codex --prompt "say \\"hi\\""'), {
    argv: ['codex', '--prompt', 'say "hi"']
  });
  assert.deepEqual(parseCommandLine(String.raw`codex --prompt "a '\" "`), {
    argv: ['codex', '--prompt', `a '" `]
  });
  assert.equal(
    buildAgentPresetCommandLine(
      'codex',
      {
        command: 'codex',
        defaultArgs: String.raw`--prompt "a '\" "`
      },
      'default'
    ),
    String.raw`codex --prompt "a '\" "`
  );

  assert.throws(
    () =>
      buildAgentPresetCommandLine(
        'codex',
        {
          command: 'codex',
          defaultArgs: '--model "o3'
        },
        'default'
    ),
    /Codex 默认启动参数无法解析：双引号未闭合。/
  );

  assert.throws(
    () =>
      buildFreshAgentCommandLine(
        'codex',
        'custom',
        'codex --yolo',
        {
          command: 'codex',
          defaultArgs: '--model "o3'
        }
      ),
    /Codex 默认启动参数无法解析：双引号未闭合。/
  );
  const invalidDefaultsCustomValidation = validateAgentCommandLine(
    'codex --yolo',
    'codex',
    {
      command: 'codex',
      defaultArgs: '--model "o3'
    }
  );
  assert.equal(invalidDefaultsCustomValidation.valid, false);
  assert.equal(invalidDefaultsCustomValidation.error, 'Codex 默认启动参数无法解析：双引号未闭合。');

  assert.deepEqual(
    classifyAgentLaunchPreset(
      'codex',
      'codex --yolo',
      {
        command: 'codex',
        defaultArgs: '--model "o3'
      }
    ),
    {
      launchPreset: 'custom',
      customLaunchCommand: 'codex --yolo'
    }
  );

  const explicitClaudeSessionFlags = ['--session-id', '--resume', '--continue', '-r', '-c'];
  assert.equal(hasAnyCommandLineFlag(['--session-id=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--resume=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--continue=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['-r', 'session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['-c=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--session-identifier=session-789'], explicitClaudeSessionFlags), false);
  assert.equal(hasAnyCommandLineFlag(['--resumable'], explicitClaudeSessionFlags), false);

  assert.deepEqual(extractClaudeCommandSessionFlag(['--resume=session-123']), {
    flag: '--resume',
    sessionId: 'session-123'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['--continue', 'session-456']), {
    flag: '--continue',
    sessionId: 'session-456'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['--resume']), {
    flag: '--resume',
    sessionId: undefined
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['-r', 'session-123']), {
    flag: '--resume',
    sessionId: 'session-123'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['-c', 'session-456']), {
    flag: '--continue',
    sessionId: 'session-456'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['-r=session-789']), {
    flag: '--resume',
    sessionId: 'session-789'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['-c']), {
    flag: '--continue',
    sessionId: undefined
  });
  assert.equal(extractClaudeCommandSessionFlag(['--yolo']), null);

  assert.equal(
    buildAgentHistoryResumeCommandLine(
      'codex',
      'session-codex-123',
      {
        command: 'codex',
        defaultArgs: '--profile prod --sandbox workspace-write'
      }
    ),
    'codex --profile prod --sandbox workspace-write resume session-codex-123'
  );
  assert.equal(
    buildAgentHistoryResumeCommandLine(
      'codex',
      'session-codex-789',
      {
        command: 'codex',
        defaultArgs: '--model gpt-5.2 resume --all --include-non-interactive session-old --sandbox workspace-write'
      }
    ),
    'codex --model gpt-5.2 resume --sandbox workspace-write session-codex-789'
  );
  assert.equal(
    buildAgentHistoryResumeCommandLine(
      'claude',
      'session-claude-456',
      {
        command: '/opt/claude',
        defaultArgs: '--model sonnet --permission-mode plan'
      }
    ),
    '/opt/claude --model sonnet --permission-mode plan --resume session-claude-456'
  );
  assert.equal(
    buildAgentHistoryResumeCommandLine(
      'claude',
      'session-claude-789',
      {
        command: 'claude',
        defaultArgs: '--resume session-old --permission-mode plan'
      }
    ),
    'claude --permission-mode plan --resume session-claude-789'
  );
  assert.throws(
    () =>
      buildAgentHistoryResumeCommandLine(
        'codex',
        '   ',
        {
          command: 'codex',
          defaultArgs: ''
        }
      ),
    /恢复会话标识不能为空。/
  );

  console.log('agentLaunchPresets tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
