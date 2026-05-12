import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type NotifierExtensionModeLabel = 'development' | 'test' | 'production';

export interface NotifierInstallRequirement {
  name: string;
  statusLabel: string;
  detail: string;
  hints?: string[];
}

export interface NotifierAgentConfigurationGuide {
  agentLabel: string;
  configPath: string;
  detail: string;
  recommendedSnippet: string;
  hints: string[];
}

export interface NotifierPlatformGuide {
  platformLabel: string;
  statusLabel: string;
  detail: string;
  hints: string[];
}

export interface NotifierEnvironmentSnapshot {
  platformLabel: string;
  modeLabel: NotifierExtensionModeLabel;
  currentRouteLabel: string;
  currentRouteDetail: string;
  activationKind: 'none' | 'protocol' | 'direct-action' | 'test-replay';
  activationLabel: string;
  activationDetail: string;
  soundLabel: string;
  soundDetail: string;
  installRequirements: NotifierInstallRequirement[];
  platformGuides: NotifierPlatformGuide[];
  agentConfigurationGuides: NotifierAgentConfigurationGuide[];
  notes: string[];
}

interface NotifierEnvironmentSnapshotInput {
  platform: NodeJS.Platform;
  modeLabel: NotifierExtensionModeLabel;
  playSoundEnabled: boolean;
  terminalNotifierAvailable?: boolean;
  notifySendAvailable?: boolean;
}

export async function probeNotifierEnvironmentSnapshot(
  platform: NodeJS.Platform,
  modeLabel: NotifierExtensionModeLabel,
  playSoundEnabled: boolean
): Promise<NotifierEnvironmentSnapshot> {
  const terminalNotifierAvailable = platform === 'darwin' ? await isCommandAvailable('terminal-notifier', platform) : false;
  const notifySendAvailable = platform === 'linux' ? await isCommandAvailable('notify-send', platform) : false;
  return buildNotifierEnvironmentSnapshot({
    platform,
    modeLabel,
    playSoundEnabled,
    terminalNotifierAvailable,
    notifySendAvailable
  });
}

export function buildNotifierEnvironmentSnapshot(
  input: NotifierEnvironmentSnapshotInput
): NotifierEnvironmentSnapshot {
  const agentConfigurationGuides = buildAgentConfigurationGuides();
  const platformGuides = buildPlatformGuides(input.platform);
  const notes = [
    '通知后端需安装在本机 UI 端，而不是 Remote SSH、WSL、Dev Container 等远端。',
    'Agent 通知配置写在 Agent 实际运行宿主上；远端 Agent 改远端配置。',
    '测试通知只验证 companion 本机桌面链路；Agent 是否发出信号取决于 CLI 配置。',
    '声音开关默认开启，实际响铃取决于系统通知设置。'
  ];

  if (input.modeLabel === 'test') {
    return {
      platformLabel: getPlatformLabel(input.platform),
      modeLabel: input.modeLabel,
      currentRouteLabel: '内存测试后端',
      currentRouteDetail: 'Extension Test 模式，通知不会发送到系统，仅记录测试结果',
      activationKind: 'test-replay',
      activationLabel: '测试回放',
      activationDetail: '通过回放 callback URI 验证回跳到画布并居中节点的功能',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '测试模式不会播放系统声音，此处仅显示配置值',
      installRequirements: [
        {
          name: '桌面通知后端',
          statusLabel: '无需安装',
          detail: '测试模式仅验证协议与回调链路，不依赖系统通知命令',
          hints: ['真实桌面通知与工具安装请回到 Development / Production 模式再验证。']
        }
      ],
      platformGuides,
      agentConfigurationGuides,
      notes
    };
  }

  if (input.platform === 'darwin') {
    if (input.terminalNotifierAvailable) {
      return {
        platformLabel: 'macOS',
        modeLabel: input.modeLabel,
        currentRouteLabel: 'terminal-notifier',
        currentRouteDetail: '使用 terminal-notifier 发送通知，支持点击回跳到 VS Code',
        activationKind: 'protocol',
        activationLabel: '协议回跳',
        activationDetail: '点击通知后通过 VS Code URI handler 回到画布',
        soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
        soundDetail:
          input.playSoundEnabled === false
            ? '已关闭提示音，terminal-notifier 将静音发送通知'
            : '将播放默认通知声音',
        installRequirements: [
          {
            name: 'terminal-notifier',
            statusLabel: '已安装',
            detail: '当前主路径可点击通知并回到 VS Code。',
            hints: [
              '新机器可执行 `brew install terminal-notifier` 保持同样主路径。',
              '若仅需要通知显示，macOS 自带的 osascript 回退无需额外安装。'
            ]
          },
          {
            name: 'osascript',
            statusLabel: '系统自带',
            detail: 'macOS 自带回退路径，无需额外安装；只保证通知显示，不支持点击回跳。'
          }
        ],
        platformGuides,
        agentConfigurationGuides,
        notes
      };
    }

    return {
      platformLabel: 'macOS',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'osascript',
      currentRouteDetail: '使用 osascript 发送通知，仅保证通知显示',
      activationKind: 'none',
      activationLabel: '不支持回跳',
      activationDetail: '点击通知后无法自动回到 VS Code',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail:
        input.playSoundEnabled === false
          ? '已关闭提示音，不会播放系统提示音'
          : '将尝试播放系统提示音',
      installRequirements: [
        {
          name: 'terminal-notifier',
          statusLabel: '建议安装',
          detail: '需要安装 terminal-notifier 才能支持点击回跳功能',
          hints: [
            '推荐命令：`brew install terminal-notifier`。',
            '如果暂时不安装，companion 会回退到 macOS 自带的 osascript，只保证通知显示。'
          ]
        }
      ],
      platformGuides,
      agentConfigurationGuides,
      notes
    };
  }

  if (input.platform === 'linux') {
    if (input.notifySendAvailable) {
      return {
        platformLabel: 'Linux',
        modeLabel: input.modeLabel,
        currentRouteLabel: 'notify-send',
        currentRouteDetail: '使用 notify-send 发送桌面通知',
        activationKind: 'direct-action',
        activationLabel: '取决于桌面环境',
        activationDetail: '是否支持点击回跳取决于桌面环境对 --action --wait 的支持',
        soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
        soundDetail:
          input.playSoundEnabled === false
            ? '已请求静音，实际效果取决于桌面环境'
            : '已请求播放提示音，实际效果取决于桌面环境',
        installRequirements: [
          {
            name: 'notify-send',
            statusLabel: '已安装',
            detail: '当前本机 UI 环境已具备 Linux 桌面通知能力。',
            hints: [
              'Debian / Ubuntu：`sudo apt install libnotify-bin`',
              'Fedora：`sudo dnf install libnotify`',
              'Arch：`sudo pacman -S libnotify`'
            ]
          },
          {
            name: '桌面环境支持',
            statusLabel: '请确认',
            detail: '是否支持点击回跳取决于桌面环境能否处理 notify-send 的 `--action --wait`。'
          }
        ],
        platformGuides,
        agentConfigurationGuides,
        notes
      };
    }

    return {
      platformLabel: 'Linux',
      modeLabel: input.modeLabel,
      currentRouteLabel: '缺少 notify-send',
      currentRouteDetail: '缺少 notify-send，无法发送桌面通知',
      activationKind: 'none',
      activationLabel: '不可用',
      activationDetail: '需要安装 notify-send 才能启用桌面通知功能',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '缺少桌面通知命令，声音设置暂不生效',
      installRequirements: [
        {
          name: 'notify-send',
          statusLabel: '未安装',
          detail: 'Linux 桌面通知依赖 notify-send',
          hints: [
            'Debian / Ubuntu：`sudo apt install libnotify-bin`',
            'Fedora：`sudo dnf install libnotify`',
            'Arch：`sudo pacman -S libnotify`'
          ]
        }
      ],
      platformGuides,
      agentConfigurationGuides,
      notes
    };
  }

  if (input.platform === 'win32') {
    return {
      platformLabel: 'Windows',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'PowerShell Toast',
      currentRouteDetail: '通过 PowerShell 生成 Windows Toast 通知',
      activationKind: 'protocol',
      activationLabel: '协议回跳',
      activationDetail: '点击通知后通过 VS Code URI handler 回到画布',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail:
        input.playSoundEnabled === false
          ? '已在 Toast XML 中请求静音'
          : '已在 Toast XML 中请求默认通知声音，实际效果取决于系统通知策略',
      installRequirements: [
        {
          name: '额外 CLI',
          statusLabel: '无需安装',
          detail: '无需额外安装通知 CLI，请确保系统通知权限与专注助手未拦截通知',
          hints: [
            'Windows 设置 -> 系统 -> 通知：确认 VS Code 与系统通知没有被禁用。',
            '如果通知未弹出，请再检查专注助手 / 勿扰模式和通知中心。'
          ]
        }
      ],
      platformGuides,
      agentConfigurationGuides,
      notes
    };
  }

  return {
    platformLabel: getPlatformLabel(input.platform),
    modeLabel: input.modeLabel,
    currentRouteLabel: '不支持',
    currentRouteDetail: '当前平台暂不支持桌面通知',
    activationKind: 'none',
    activationLabel: '不可用',
    activationDetail: '当前环境无法发送桌面通知',
    soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
    soundDetail: '当前平台不支持桌面通知，声音设置不生效',
    installRequirements: [
      {
        name: '平台支持',
        statusLabel: '不支持',
        detail: `平台 ${input.platform} 暂不在支持列表内`
      }
    ],
    platformGuides,
    agentConfigurationGuides,
    notes
  };
}

function buildAgentConfigurationGuides(): NotifierAgentConfigurationGuide[] {
  return [
    {
      agentLabel: 'Codex',
      configPath: '~/.codex/config.toml',
      detail: '在 Agent 实际运行宿主上的 Codex TUI 配置里开启通知，才能稳定输出 OSC 9 并被画布 attention bridge 捕获。',
      recommendedSnippet: ['[tui]', 'notifications = true', 'notification_method = "osc9"', 'notification_condition = "always"'].join(
        '\n'
      ),
      hints: [
        '如果文件已存在，只补 `[tui]` 相关项即可，不必覆盖其它模型、审批或 sandbox 配置。',
        '若使用主扩展生成默认模板，这三项通知配置已默认带入。'
      ]
    },
    {
      agentLabel: 'Claude Code',
      configPath: '~/.claude/settings.json',
      detail: '在 Agent 实际运行宿主上的 Claude Code settings 中启用 iTerm2 风格通知通道，让 CLI 进入同一条 attention signal 桥接链路。',
      recommendedSnippet: ['{', '  "preferredNotifChannel": "iterm2"', '}'].join('\n'),
      hints: [
        '如果 `settings.json` 已有其它字段，只合并 `preferredNotifChannel`，不要整文件替换。',
        '若使用主扩展生成默认模板，这一项已默认带入；无需额外 hooks。'
      ]
    }
  ];
}

function buildPlatformGuides(currentPlatform: NodeJS.Platform): NotifierPlatformGuide[] {
  const currentPlatformLabel = getPlatformLabel(currentPlatform);
  return [
    {
      platformLabel: 'macOS',
      statusLabel: currentPlatformLabel === 'macOS' ? '当前平台' : '参考',
      detail: '推荐安装 terminal-notifier 以支持点击通知后回到 VS Code；未安装时回退到系统自带的 osascript，只保证通知显示。',
      hints: [
        '推荐命令：`brew install terminal-notifier`',
        '仅需通知显示时无需额外 CLI，macOS 自带 osascript 回退。'
      ]
    },
    {
      platformLabel: 'Linux',
      statusLabel: currentPlatformLabel === 'Linux' ? '当前平台' : '参考',
      detail: '需要 notify-send 才能发送桌面通知；点击回跳是否可用取决于桌面环境对 `--action --wait` 的支持。',
      hints: [
        'Debian / Ubuntu：`sudo apt install libnotify-bin`',
        'Fedora：`sudo dnf install libnotify`',
        'Arch：`sudo pacman -S libnotify`'
      ]
    },
    {
      platformLabel: 'Windows',
      statusLabel: currentPlatformLabel === 'Windows' ? '当前平台' : '参考',
      detail: '无需额外安装通知 CLI；确认系统通知权限、专注助手 / 勿扰模式和通知中心没有拦截 VS Code Toast。',
      hints: [
        'Windows 设置 -> 系统 -> 通知：确认 VS Code 与系统通知处于允许状态。',
        '若通知未出现，请先检查专注助手 / 勿扰模式和通知中心。'
      ]
    }
  ];
}

async function isCommandAvailable(command: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (platform === 'win32') {
      const result = await execFileAsync('where.exe', [command], {
        windowsHide: true
      });
      return result.stdout.trim().length > 0;
    }

    const result = await execFileAsync('which', [command]);
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function getPlatformLabel(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return 'macOS';
  }

  if (platform === 'linux') {
    return 'Linux';
  }

  if (platform === 'win32') {
    return 'Windows';
  }

  return platform;
}
