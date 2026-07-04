import * as vscode from 'vscode';

import {
  formatAgentLaunchMessageDescriptor,
  getAgentLaunchErrorDescriptor,
  type AgentLaunchConflictDescriptionId,
  type AgentLaunchMessageDescriptor
} from '../common/agentLaunchPresets';
import {
  formatAgentCliResolutionAttemptDescriptor,
  type AgentCliResolutionAttemptDescriptor,
  type AgentCliResolutionError
} from './agentCliResolver';

export function localizeAgentLaunchError(error: unknown, fallback?: string): string | undefined {
  const descriptor = getAgentLaunchErrorDescriptor(error);
  if (!descriptor) {
    return undefined;
  }

  return localizeAgentLaunchMessageDescriptor(descriptor, fallback);
}

export function localizeAgentLaunchMessageDescriptor(
  descriptor: AgentLaunchMessageDescriptor | undefined,
  fallback?: string
): string {
  if (!descriptor) {
    return fallback ?? vscode.l10n.t('Unable to parse the Agent launch command.');
  }

  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'resumeSessionIdEmpty':
      return vscode.l10n.t('Resume session id cannot be empty.');
    case 'forkSessionIdEmpty':
      return vscode.l10n.t('Fork session id cannot be empty.');
    case 'launchCommandEmpty':
      return vscode.l10n.t('Launch command cannot be empty.');
    case 'claudeCommandMismatch':
      return vscode.l10n.t('Command must start with the current Claude Code command or claude.');
    case 'codexCommandMismatch':
      return vscode.l10n.t('Command must start with the current Codex command or codex.');
    case 'doubleQuoteUnclosed':
      return vscode.l10n.t('Double quote is not closed.');
    case 'singleQuoteUnclosed':
      return vscode.l10n.t('Single quote is not closed.');
    case 'defaultArgsParseError':
      return vscode.l10n.t('{provider} default launch arguments could not be parsed: {message}', {
        provider: params.provider ?? 'Agent',
        message: descriptor.cause
          ? localizeAgentLaunchMessageDescriptor(descriptor.cause)
          : params.message ?? ''
      });
    case 'defaultArgsConflict':
      return vscode.l10n.t(
        '{provider} default launch arguments cannot include {description} {token} because it conflicts with Resume / Fork. Remove it from Default args, use the Resume / Fork entry instead, or put one-time session targets in a custom launch command.',
        {
          provider: params.provider ?? 'Agent',
          description: localizeAgentLaunchConflictDescription(
            params.descriptionId as AgentLaunchConflictDescriptionId | undefined,
            params.description
          ),
          token: params.token ?? ''
        }
      );
    default:
      return fallback ?? formatAgentLaunchMessageDescriptor(descriptor);
  }
}

export function localizeAgentCliResolutionErrorMessage(error: AgentCliResolutionError): string {
  const attemptDescriptors = Array.isArray(error.attemptDescriptors)
    ? error.attemptDescriptors
    : Array.isArray(error.attempts)
      ? error.attempts.map((attempt) => ({ id: 'raw' as const, value: attempt }))
      : [];
  const attempts = attemptDescriptors.map(localizeAgentCliResolutionAttemptDescriptor);
  const summary = attempts.length > 0
    ? vscode.l10n.t('Tried: {attempts}. ', { attempts: attempts.join(vscode.l10n.t('; ')) })
    : '';
  const suffix = process.platform === 'win32'
    ? vscode.l10n.t(
        'Make sure it is installed in the current execution host, configure the .exe / .cmd path explicitly in settings, or make it available to the login shell / PATH.'
      )
    : vscode.l10n.t(
        'Make sure it is installed in the current execution host, configure the command path explicitly in settings, or make it available to the login shell / PATH.'
      );

  return vscode.l10n.t('Could not find {label} command {requestedCommand}. {summary}{suffix}', {
    label: typeof error.label === 'string' ? error.label : 'Agent',
    requestedCommand: typeof error.requestedCommand === 'string' ? error.requestedCommand : '<unknown>',
    summary,
    suffix
  });
}

function localizeAgentLaunchConflictDescription(
  id: AgentLaunchConflictDescriptionId | undefined,
  fallback?: string
): string {
  switch (id) {
    case 'positionalArgumentSeparator':
      return vscode.l10n.t('positional argument separator');
    case 'sessionSelectionArgument':
      return vscode.l10n.t('session selection argument');
    case 'sessionTargetSubcommand':
      return vscode.l10n.t('session target subcommand');
    case 'positionalArgument':
      return vscode.l10n.t('positional argument (prompt/session)');
    case 'forkFlagArgument':
      return vscode.l10n.t('Fork flag argument');
    case 'sessionTargetArgument':
      return vscode.l10n.t('session target argument');
    default:
      return fallback ?? vscode.l10n.t('argument');
  }
}

function localizeAgentCliResolutionAttemptDescriptor(descriptor: AgentCliResolutionAttemptDescriptor): string {
  const value = descriptor.value ?? '';
  switch (descriptor.id) {
    case 'empty-configured-value':
      return vscode.l10n.t('Empty configured value');
    case 'configured-absolute':
      return vscode.l10n.t('Configured absolute path: {value}', { value });
    case 'configured-relative':
      return vscode.l10n.t('Configured relative path: {value}', { value });
    case 'cache':
      return vscode.l10n.t('Cached resolution: {value}', { value });
    case 'path-env':
      return vscode.l10n.t('PATH lookup: {value}', { value });
    case 'windows-where':
      return vscode.l10n.t('where.exe probe: {value}', { value });
    case 'windows-powershell':
      return vscode.l10n.t('Get-Command probe: {value}', { value });
    case 'posix-login-shell':
      return vscode.l10n.t('Login shell probe: {value}', { value });
    case 'raw':
    default:
      return formatAgentCliResolutionAttemptDescriptor(descriptor);
  }
}
