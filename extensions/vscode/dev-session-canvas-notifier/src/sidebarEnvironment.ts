import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type NotifierExtensionModeLabel = 'development' | 'test' | 'production';

export interface NotifierInstallRequirement {
  name: string;
  statusLabel: string;
  detail: string;
  installHint?: string;
}

export interface NotifierEnvironmentSnapshot {
  platformLabel: string;
  modeLabel: NotifierExtensionModeLabel;
  currentRouteLabel: string;
  currentRouteDetail: string;
  activationLabel: string;
  activationDetail: string;
  soundLabel: string;
  soundDetail: string;
  installRequirements: NotifierInstallRequirement[];
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
  const notes = [
    '这里显示的是当前本机 UI 侧环境，不代表远端 workspace 主机。',
    '如需确认真实回跳能力，请从本视图或命令面板发送一次测试桌面通知。',
    '声音开关默认开启；实际是否响铃仍取决于平台后端和系统通知服务。'
  ];

  if (input.modeLabel === 'test') {
    return {
      platformLabel: getPlatformLabel(input.platform),
      modeLabel: input.modeLabel,
      currentRouteLabel: 'in-memory test backend',
      currentRouteDetail: '当前为 Extension Test 模式，通知不会触达真实系统，而是直接记录测试结果。',
      activationLabel: 'test-replay',
      activationDetail: '测试环境通过回放 callback URI 验证“聚焦节点 / 清除 attention”链路。',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '测试模式不会触发真实系统声音；这里只反映当前配置值。',
      installRequirements: [
        {
          name: '真实桌面通知后端',
          statusLabel: '本模式不需要',
          detail: '当前模式只验证协议与回调链路，不依赖本机通知命令。'
        }
      ],
      notes
    };
  }

  if (input.platform === 'darwin') {
    if (input.terminalNotifierAvailable) {
      return {
        platformLabel: 'macOS',
        modeLabel: input.modeLabel,
        currentRouteLabel: 'terminal-notifier',
        currentRouteDetail: '当前环境会优先走 terminal-notifier，并通过 -open 回到 VS Code。',
        activationLabel: 'protocol',
        activationDetail: '系统通知支持点击后回到 VS Code URI handler。',
        soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
        soundDetail:
          input.playSoundEnabled === false
            ? '当前已关闭提示音，terminal-notifier 会按静音路径发送。'
            : '当前会请求 terminal-notifier 播放默认通知声音。',
        installRequirements: [
          {
            name: 'terminal-notifier',
            statusLabel: '已检测到',
            detail: '当前机器已具备可点击回跳的推荐后端。',
            installHint: '新机器可通过 brew install terminal-notifier 预装。'
          }
        ],
        notes
      };
    }

    return {
      platformLabel: 'macOS',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'osascript',
      currentRouteDetail: '当前环境会退回 osascript display notification，只保证通知出现。',
      activationLabel: 'none',
      activationDetail: '当前路径不支持点击通知后自动回到 VS Code。',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail:
        input.playSoundEnabled === false
          ? '当前已关闭提示音，osascript 回退路径不会再额外播放系统 alert sound。'
          : '当前会在投递通知前 best-effort 播放一次系统 alert sound。',
      installRequirements: [
        {
          name: 'terminal-notifier',
          statusLabel: '未检测到',
          detail: '如需点击系统通知后回到 VS Code，需要预装 terminal-notifier。',
          installHint: '建议执行 brew install terminal-notifier。'
        }
      ],
      notes
    };
  }

  if (input.platform === 'linux') {
    if (input.notifySendAvailable) {
      return {
        platformLabel: 'Linux',
        modeLabel: input.modeLabel,
        currentRouteLabel: 'notify-send',
        currentRouteDetail: '当前环境会调用 notify-send 投递桌面通知。',
        activationLabel: 'direct-action / none',
        activationDetail: '是否支持点击回跳，取决于桌面环境对 notify-send --action --wait 的支持。',
        soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
        soundDetail:
          input.playSoundEnabled === false
            ? '当前会请求通知服务尽量静音；最终是否完全静音取决于桌面环境。'
            : '当前会通过 sound-name hint 请求提示音；最终是否响铃取决于桌面环境。',
        installRequirements: [
          {
            name: 'notify-send',
            statusLabel: '已检测到',
            detail: '当前机器已具备 Linux 桌面通知命令。',
            installHint: '新机器通常可通过安装 libnotify-bin 或发行版等价包准备。'
          }
        ],
        notes
      };
    }

    return {
      platformLabel: 'Linux',
      modeLabel: input.modeLabel,
      currentRouteLabel: '缺少 notify-send',
      currentRouteDetail: '当前环境缺少 notify-send，notifier 无法投递真实桌面通知。',
      activationLabel: 'unavailable',
      activationDetail: '安装 notify-send 后，系统通知主路径才会生效。',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '当前缺少 Linux 桌面通知命令，声音设置暂时不会生效。',
      installRequirements: [
        {
          name: 'notify-send',
          statusLabel: '未检测到',
          detail: 'Linux 真实桌面通知依赖 notify-send。',
          installHint: 'Debian/Ubuntu 常见安装方式是 sudo apt install libnotify-bin。'
        }
      ],
      notes
    };
  }

  if (input.platform === 'win32') {
    return {
      platformLabel: 'Windows',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'PowerShell toast',
      currentRouteDetail: '当前环境会通过 PowerShell 生成 Windows Toast 通知。',
      activationLabel: 'protocol',
      activationDetail: '系统通知支持点击后回到 VS Code URI handler。',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail:
        input.playSoundEnabled === false
          ? '当前会在 Toast XML 中显式请求静音。'
          : '当前会在 Toast XML 中请求默认通知声音；最终是否响铃取决于系统通知策略。',
      installRequirements: [
        {
          name: '额外 CLI',
          statusLabel: '不需要',
          detail: '默认无需额外安装通知 CLI；请确保系统通知权限与 Focus Assist 未拦截弹窗。'
        }
      ],
      notes
    };
  }

  return {
    platformLabel: getPlatformLabel(input.platform),
    modeLabel: input.modeLabel,
    currentRouteLabel: 'unsupported',
    currentRouteDetail: '当前平台未映射到桌面通知后端。',
    activationLabel: 'none',
    activationDetail: '本环境下不会触发可点击回跳的桌面通知。',
    soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
    soundDetail: '当前平台未支持桌面通知后端，声音开关不会生效。',
    installRequirements: [
      {
        name: '支持状态',
        statusLabel: '未支持',
        detail: `平台 ${input.platform} 当前不在 notifier 支持列表内。`
      }
    ],
    notes
  };
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
