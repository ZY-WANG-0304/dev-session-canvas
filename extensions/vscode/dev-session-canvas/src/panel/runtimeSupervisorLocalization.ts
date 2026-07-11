import * as vscode from 'vscode';

import {
  formatRuntimeSupervisorMessageDescriptor,
  getRuntimeSupervisorErrorDescriptor,
  type RuntimeSupervisorMessageDescriptor,
  type RuntimeSupervisorSessionSnapshot
} from '../common/runtimeSupervisorProtocol';

export function localizeRuntimeSupervisorSnapshotExitMessage(
  snapshot: Pick<RuntimeSupervisorSessionSnapshot, 'lastExitMessage' | 'lastExitMessageDescriptor'>,
  fallback?: string
): string | undefined {
  if (!snapshot.lastExitMessageDescriptor && !snapshot.lastExitMessage && !fallback) {
    return undefined;
  }

  return localizeRuntimeSupervisorMessageDescriptor(snapshot.lastExitMessageDescriptor, snapshot.lastExitMessage ?? fallback);
}

export function localizeRuntimeSupervisorError(error: unknown, fallback?: string): string | undefined {
  const descriptor = getRuntimeSupervisorErrorDescriptor(error);
  if (!descriptor) {
    return undefined;
  }

  return localizeRuntimeSupervisorMessageDescriptor(
    descriptor,
    error instanceof Error ? error.message : fallback
  );
}

export function localizeRuntimeSupervisorMessageDescriptor(
  descriptor: RuntimeSupervisorMessageDescriptor | undefined,
  fallback?: string
): string {
  if (!descriptor) {
    return fallback ?? vscode.l10n.t('Runtime supervisor operation failed.');
  }

  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'parseError':
      return params.message
        ? vscode.l10n.t('Could not parse runtime supervisor message: {message}', { message: params.message })
        : vscode.l10n.t('Could not parse runtime supervisor message.');
    case 'sessionAlreadyExists':
      return vscode.l10n.t('Runtime session {sessionId} already exists.', {
        sessionId: params.sessionId ?? vscode.l10n.t('<unknown>')
      });
    case 'sessionNotFound':
      return vscode.l10n.t('Runtime session {sessionId} was not found.', {
        sessionId: params.sessionId ?? vscode.l10n.t('<unknown>')
      });
    case 'sessionNotLive':
      return vscode.l10n.t('Runtime session {sessionId} is not live.', {
        sessionId: params.sessionId ?? vscode.l10n.t('<unknown>')
      });
    case 'claudeAgentCtrlZUnsupported':
      return vscode.l10n.t('Claude Agent nodes do not support Ctrl-Z/fg. Use stop, resume, or fork instead.');
    case 'claudeCodeSuspended':
      return vscode.l10n.t('Claude Code is suspended. Click "Stop" to end the session, then restart.');
    case 'agentSessionDeleted':
      return vscode.l10n.t('Agent session deleted.');
    case 'terminalSessionDeleted':
      return vscode.l10n.t('Terminal session deleted.');
    case 'agentSessionStopped':
      return vscode.l10n.t('Stopped {label} session.', { label: params.label ?? 'Agent' });
    case 'agentSessionEnded':
      return vscode.l10n.t('{label} session ended.', { label: params.label ?? 'Agent' });
    case 'terminalStopped':
      return vscode.l10n.t('Terminal stopped.');
    case 'terminalSessionEnded':
      return vscode.l10n.t('Terminal session ended.');
    case 'recoveredHistoryOnly':
      return vscode.l10n.t('The session supervisor did not retain the original live runtime. Only history results were restored.');
    case 'agentExitedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('{label} exited with signal {signal}.', {
          label: params.label ?? 'Agent',
          signal: params.signal ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'agentExitedCode':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('{label} exited with code {code}.', {
          label: params.label ?? 'Agent',
          code: params.code ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'agentResumeFailedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('Resuming {label} received signal {signal}.', {
          label: params.label ?? 'Agent',
          signal: params.signal ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'agentResumeFailedCode':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('Resuming {label} ended with code {code}.', {
          label: params.label ?? 'Agent',
          code: params.code ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'terminalExitedSignal':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('Terminal {shellPath} exited with signal {signal}.', {
          shellPath: params.shellPath ?? vscode.l10n.t('<unknown>'),
          signal: params.signal ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'terminalExitedCode':
      return appendRuntimeSupervisorSummarySuffix(
        vscode.l10n.t('Terminal {shellPath} exited with code {code}.', {
          shellPath: params.shellPath ?? vscode.l10n.t('<unknown>'),
          code: params.code ?? vscode.l10n.t('<unknown>')
        }),
        params.suffix
      );
    case 'supervisorMissingStorageDir':
      return vscode.l10n.t('Runtime supervisor failed to start: missing --storage-dir.');
    case 'launcherMissingSupervisorScript':
      return vscode.l10n.t('Runtime supervisor launcher failed to start: missing --supervisor-script.');
    case 'launcherMissingStorageDir':
      return vscode.l10n.t('Runtime supervisor launcher failed to start: missing --storage-dir.');
    case 'legacySocketPathUnavailable':
      return vscode.l10n.t('Could not create a legacy runtime supervisor path within the Unix socket limit.');
    case 'systemdUserUnsupportedOnWindows':
      return vscode.l10n.t('The systemd-user backend does not support Windows.');
    case 'systemdControlPathUnavailable':
      return vscode.l10n.t('Could not create a systemd-user control path within the Unix socket limit.');
    case 'homeDirectoryUnavailable':
      return vscode.l10n.t('Could not resolve the current user home directory, so the runtime host backend cannot initialize.');
    case 'clientDisposed':
      return vscode.l10n.t('RuntimeSupervisorClient has been disposed.');
    case 'clientDisconnected':
      return vscode.l10n.t('RuntimeSupervisorClient disconnected.');
    case 'clientNotConnected':
      return vscode.l10n.t('Could not connect to the runtime supervisor.');
    case 'clientConnectionClosed':
      return vscode.l10n.t('Runtime supervisor connection closed.');
    case 'clientReadyTimeout':
      return vscode.l10n.t('Timed out waiting for the runtime supervisor to start.');
    case 'systemdBackendMissingPaths':
      return vscode.l10n.t('The systemd-user backend is missing unit or controlDir paths.');
    case 'systemdCommandFailed':
      return params.detail
        ? vscode.l10n.t('{command} failed: {detail}', {
            command: params.command ?? 'systemctl --user',
            detail: params.detail
          })
        : vscode.l10n.t('{command} failed.', { command: params.command ?? 'systemctl --user' });
    default:
      return fallback ?? formatRuntimeSupervisorMessageDescriptor(descriptor);
  }
}

function appendRuntimeSupervisorSummarySuffix(message: string, suffix?: string): string {
  const normalizedSuffix = suffix?.trim();
  return normalizedSuffix ? `${message} ${normalizedSuffix}` : message;
}
