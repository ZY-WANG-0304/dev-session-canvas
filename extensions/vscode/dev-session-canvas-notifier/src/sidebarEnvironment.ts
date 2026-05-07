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
    '显示的是本地 UI 环境信息，远程 workspace 环境可能不同',
    '可通过发送测试通知验证回跳功能是否正常工作',
    '声音开关默认开启，实际响铃取决于系统通知设置'
  ];

  if (input.modeLabel === 'test') {
    return {
      platformLabel: getPlatformLabel(input.platform),
      modeLabel: input.modeLabel,
      currentRouteLabel: '内存测试后端',
      currentRouteDetail: 'Extension Test 模式，通知不会发送到系统，仅记录测试结果',
      activationLabel: '测试回放',
      activationDetail: '通过回放 callback URI 验证回跳到画布并居中节点的功能',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '测试模式不会播放系统声音，此处仅显示配置值',
      installRequirements: [
        {
          name: '桌面通知后端',
          statusLabel: '无需安装',
          detail: '测试模式仅验证协议与回调链路，不依赖系统通知命令'
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
        currentRouteDetail: '使用 terminal-notifier 发送通知，支持点击回跳到 VS Code',
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
            detail: '已具备点击回跳功能',
            installHint: '新机器可通过 brew install terminal-notifier 安装'
          }
        ],
        notes
      };
    }

    return {
      platformLabel: 'macOS',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'osascript',
      currentRouteDetail: '使用 osascript 发送通知，仅保证通知显示',
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
          statusLabel: '未安装',
          detail: '需要安装 terminal-notifier 才能支持点击回跳功能',
          installHint: '建议执行 brew install terminal-notifier'
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
        currentRouteDetail: '使用 notify-send 发送桌面通知',
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
            detail: '已具备 Linux 桌面通知能力',
            installHint: '新机器可通过安装 libnotify-bin 或发行版等价包获得'
          }
        ],
        notes
      };
    }

    return {
      platformLabel: 'Linux',
      modeLabel: input.modeLabel,
      currentRouteLabel: '缺少 notify-send',
      currentRouteDetail: '缺少 notify-send，无法发送桌面通知',
      activationLabel: '不可用',
      activationDetail: '需要安装 notify-send 才能启用桌面通知功能',
      soundLabel: input.playSoundEnabled ? '已开启' : '已关闭',
      soundDetail: '缺少桌面通知命令，声音设置暂不生效',
      installRequirements: [
        {
          name: 'notify-send',
          statusLabel: '未安装',
          detail: 'Linux 桌面通知依赖 notify-send',
          installHint: 'Debian/Ubuntu 可执行 sudo apt install libnotify-bin'
        }
      ],
      notes
    };
  }

  if (input.platform === 'win32') {
    return {
      platformLabel: 'Windows',
      modeLabel: input.modeLabel,
      currentRouteLabel: 'PowerShell Toast',
      currentRouteDetail: '通过 PowerShell 生成 Windows Toast 通知',
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
          detail: '无需额外安装通知 CLI，请确保系统通知权限与专注助手未拦截通知'
        }
      ],
      notes
    };
  }

  return {
    platformLabel: getPlatformLabel(input.platform),
    modeLabel: input.modeLabel,
    currentRouteLabel: '不支持',
    currentRouteDetail: '当前平台暂不支持桌面通知',
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
