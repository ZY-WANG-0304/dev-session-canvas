import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  identityNotifierLocalize,
  type NotifierLocalize
} from './notifierLocalization.ts';

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
  sections?: NotifierPlatformGuideSection[];
}

export interface NotifierPlatformGuideSection {
  title: string;
  detail: string;
  hints?: string[];
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
  playSoundEnabled: boolean,
  l10n: NotifierLocalize = identityNotifierLocalize
): Promise<NotifierEnvironmentSnapshot> {
  const terminalNotifierAvailable = platform === 'darwin' ? await isCommandAvailable('terminal-notifier', platform) : false;
  const notifySendAvailable = platform === 'linux' ? await isCommandAvailable('notify-send', platform) : false;
  return buildNotifierEnvironmentSnapshot(
    {
      platform,
      modeLabel,
      playSoundEnabled,
      terminalNotifierAvailable,
      notifySendAvailable
    },
    l10n
  );
}

export function buildNotifierEnvironmentSnapshot(
  input: NotifierEnvironmentSnapshotInput,
  l10n: NotifierLocalize = identityNotifierLocalize
): NotifierEnvironmentSnapshot {
  const agentConfigurationGuides = buildAgentConfigurationGuides(l10n);
  const platformGuides = buildPlatformGuides(input.platform, l10n);
  const notes = [
    l10n('Install the notification backend on the local UI side, not inside Remote SSH, WSL, Dev Container, or another remote host.'),
    l10n('Configure Agent notifications on the host where the Agent actually runs; remote Agents need remote CLI configuration.'),
    l10n('The test notification only validates the companion desktop path; whether an Agent emits a signal depends on CLI configuration.'),
    l10n('Sound is requested by default, but the actual alert sound still depends on system notification settings.')
  ];

  if (input.modeLabel === 'test') {
    return {
      platformLabel: getPlatformLabel(input.platform),
      modeLabel: input.modeLabel,
      currentRouteLabel: l10n('In-memory test backend'),
      currentRouteDetail: l10n('Extension Test mode records notifications in memory and does not send them to the operating system.'),
      activationKind: 'test-replay',
      activationLabel: l10n('Test replay'),
      activationDetail: l10n('Replays the callback URI to verify that VS Code can return to the canvas and center the node.'),
      soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
      soundDetail: l10n('Test mode does not play system sounds; this value only reflects the current setting.'),
      installRequirements: [
        {
          name: l10n('Desktop notification backend'),
          statusLabel: l10n('No install needed'),
          detail: l10n('Test mode validates the protocol and callback path without relying on system notification commands.'),
          hints: [l10n('Switch back to Development or Production mode before validating real desktop notifications and tool installation.')]
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
        currentRouteDetail: l10n('Uses terminal-notifier to send notifications and supports clicking back into VS Code.'),
        activationKind: 'protocol',
        activationLabel: l10n('Protocol callback'),
        activationDetail: l10n('Clicking the notification returns to the canvas through the VS Code URI handler.'),
        soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
        soundDetail:
          input.playSoundEnabled === false
            ? l10n('Sound is disabled; terminal-notifier will request a silent notification.')
            : l10n('The default notification sound will be requested.'),
        installRequirements: [
          {
            name: 'terminal-notifier',
            statusLabel: l10n('Installed'),
            detail: l10n('The current primary path can click notifications and return to VS Code.'),
            hints: [
              l10n('On a new machine, run `brew install terminal-notifier` to keep the same primary path.'),
              l10n('If you only need the notification to appear, the built-in macOS osascript fallback needs no extra installation.')
            ]
          },
          {
            name: 'osascript',
            statusLabel: l10n('Built in'),
            detail: l10n('macOS includes this fallback path; it only guarantees that notifications appear and does not support click callbacks.')
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
      currentRouteDetail: l10n('Uses osascript to send notifications and only guarantees that they appear.'),
      activationKind: 'none',
      activationLabel: l10n('No callback support'),
      activationDetail: l10n('Clicking the notification cannot automatically return to VS Code.'),
      soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
      soundDetail:
        input.playSoundEnabled === false
          ? l10n('Sound is disabled; no system alert sound will be requested.')
          : l10n('A system alert sound will be requested when possible.'),
      installRequirements: [
        {
          name: 'terminal-notifier',
          statusLabel: l10n('Recommended'),
          detail: l10n('Install terminal-notifier to support click callbacks.'),
          hints: [
            l10n('Recommended command: `brew install terminal-notifier`.'),
            l10n('Without it, the companion falls back to the built-in macOS osascript path and only guarantees that notifications appear.')
          ]
        },
        {
          name: 'osascript',
          statusLabel: l10n('Current fallback'),
          detail: l10n('This built-in macOS fallback needs no extra installation, but it only guarantees that notifications appear and does not support click callbacks.')
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
        currentRouteDetail: l10n('Uses notify-send to send desktop notifications.'),
        activationKind: 'direct-action',
        activationLabel: l10n('Depends on desktop environment'),
        activationDetail: l10n('Click callback support depends on whether the desktop environment supports `notify-send --action --wait`.'),
        soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
        soundDetail:
          input.playSoundEnabled === false
            ? l10n('Silent delivery is requested; the actual behavior depends on the desktop environment.')
            : l10n('A notification sound is requested; the actual behavior depends on the desktop environment.'),
        installRequirements: [
          {
            name: 'notify-send',
            statusLabel: l10n('Installed'),
            detail: l10n('The current local UI environment has Linux desktop notification support.'),
            hints: buildLinuxInstallHints(l10n)
          },
          {
            name: l10n('Desktop environment support'),
            statusLabel: l10n('Confirm manually'),
            detail: l10n('Click callbacks depend on whether the desktop environment can handle `notify-send --action --wait`.')
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
      currentRouteLabel: l10n('Missing notify-send'),
      currentRouteDetail: l10n('notify-send is missing, so desktop notifications cannot be sent.'),
      activationKind: 'none',
      activationLabel: l10n('Unavailable'),
      activationDetail: l10n('Install notify-send before enabling desktop notifications.'),
      soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
      soundDetail: l10n('The desktop notification command is missing, so the sound setting has no effect yet.'),
      installRequirements: [
        {
          name: 'notify-send',
          statusLabel: l10n('Not installed'),
          detail: l10n('Linux desktop notifications depend on notify-send.'),
          hints: buildLinuxInstallHints(l10n)
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
      currentRouteDetail: l10n('Uses PowerShell to create Windows Toast notifications.'),
      activationKind: 'protocol',
      activationLabel: l10n('Protocol callback'),
      activationDetail: l10n('Clicking the notification returns to the canvas through the VS Code URI handler.'),
      soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
      soundDetail:
        input.playSoundEnabled === false
          ? l10n('The Toast XML requests silent delivery.')
          : l10n('The Toast XML requests the default notification sound, subject to system notification policy.'),
      installRequirements: [
        {
          name: l10n('Extra CLI'),
          statusLabel: l10n('No install needed'),
          detail: l10n('No extra notification CLI is required; make sure system notification permissions and Focus Assist do not block the toast.'),
          hints: [
            l10n('Windows Settings -> System -> Notifications: confirm that VS Code and system notifications are allowed.'),
            l10n('If the notification does not appear, also check Focus Assist / Do Not Disturb and Notification Center.')
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
    currentRouteLabel: l10n('Unsupported'),
    currentRouteDetail: l10n('The current platform is not supported for desktop notifications.'),
    activationKind: 'none',
    activationLabel: l10n('Unavailable'),
    activationDetail: l10n('This environment cannot send desktop notifications.'),
    soundLabel: formatSoundLabel(input.playSoundEnabled, l10n),
    soundDetail: l10n('The current platform does not support desktop notifications, so the sound setting has no effect.'),
    installRequirements: [
      {
        name: l10n('Platform support'),
        statusLabel: l10n('Unsupported'),
        detail: l10n('Platform {platform} is not currently supported.', { platform: input.platform })
      }
    ],
    platformGuides,
    agentConfigurationGuides,
    notes
  };
}

function buildAgentConfigurationGuides(l10n: NotifierLocalize): NotifierAgentConfigurationGuide[] {
  return [
    {
      agentLabel: 'Codex',
      configPath: '~/.codex/config.toml',
      detail: l10n('Enable notifications in the Codex TUI configuration on the host where the Agent actually runs so it can emit OSC 9 and enter the canvas attention bridge.'),
      recommendedSnippet: ['[tui]', 'notifications = true', 'notification_method = "osc9"', 'notification_condition = "always"'].join(
        '\n'
      ),
      hints: [
        l10n('If the file already exists, only add the `[tui]` keys; do not overwrite model, approval, or sandbox settings.'),
        l10n('When you create Agents from the built-in default template, these notification settings are already included by default.')
      ]
    },
    {
      agentLabel: 'Claude Code',
      configPath: '~/.claude/settings.json',
      detail: l10n('Enable the iTerm2-style notification channel in Claude Code settings on the host where the Agent actually runs so it enters the same attention signal bridge.'),
      recommendedSnippet: ['{', '  "preferredNotifChannel": "iterm2"', '}'].join('\n'),
      hints: [
        l10n('If `settings.json` already has other fields, merge `preferredNotifChannel` instead of replacing the whole file.'),
        l10n('When you create Agents from the built-in default template, this setting is already included; no extra hooks are required.')
      ]
    }
  ];
}

function buildPlatformGuides(currentPlatform: NodeJS.Platform, l10n: NotifierLocalize): NotifierPlatformGuide[] {
  const currentPlatformLabel = getPlatformLabel(currentPlatform);
  return [
    {
      platformLabel: 'macOS',
      statusLabel: currentPlatformLabel === 'macOS' ? l10n('Current platform') : l10n('Reference'),
      detail: l10n('Install terminal-notifier to support clicking a notification back into VS Code; without it, the companion falls back to the built-in osascript path and only guarantees notification display.'),
      hints: [
        l10n('Recommended command: `brew install terminal-notifier`'),
        l10n('If you only need notifications to appear, the built-in macOS osascript fallback needs no extra CLI.')
      ],
      sections: [
        {
          title: 'terminal-notifier',
          detail: l10n('Recommended primary path; supports clicking notifications back into the canvas through the VS Code URI handler.'),
          hints: [l10n('Install command: `brew install terminal-notifier`.')]
        },
        {
          title: 'osascript',
          detail: l10n('Built-in macOS fallback; needs no extra CLI, but only guarantees that notifications appear and does not support click callbacks.')
        }
      ]
    },
    {
      platformLabel: 'Linux',
      statusLabel: currentPlatformLabel === 'Linux' ? l10n('Current platform') : l10n('Reference'),
      detail: l10n('Requires notify-send to send desktop notifications; click callback availability depends on desktop environment support for `--action --wait`.'),
      hints: buildLinuxInstallHints(l10n)
    },
    {
      platformLabel: 'Windows',
      statusLabel: currentPlatformLabel === 'Windows' ? l10n('Current platform') : l10n('Reference'),
      detail: l10n('No extra notification CLI is required; confirm that system notification permissions, Focus Assist / Do Not Disturb, and Notification Center are not blocking VS Code Toasts.'),
      hints: [
        l10n('Windows Settings -> System -> Notifications: confirm that VS Code and system notifications are allowed.'),
        l10n('If the notification does not appear, check Focus Assist / Do Not Disturb and Notification Center first.')
      ]
    }
  ];
}

function buildLinuxInstallHints(l10n: NotifierLocalize): string[] {
  return [
    l10n('Debian / Ubuntu: `sudo apt install libnotify-bin`'),
    l10n('Fedora: `sudo dnf install libnotify`'),
    l10n('Arch: `sudo pacman -S libnotify`')
  ];
}

function formatSoundLabel(playSoundEnabled: boolean, l10n: NotifierLocalize): string {
  return playSoundEnabled ? l10n('On') : l10n('Off');
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
