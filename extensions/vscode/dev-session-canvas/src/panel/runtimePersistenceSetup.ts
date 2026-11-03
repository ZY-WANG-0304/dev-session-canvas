import * as vscode from 'vscode';

import { COMMAND_IDS, CONFIG_KEYS } from '../common/extensionIdentity';
import {
  inspectRuntimePersistenceCapability, runtimeLingerCommand, sameRuntimePersistenceTarget,
  type RuntimePersistenceCapability, type RuntimePersistenceTarget
} from '../supervisor/runtimePersistenceCapability';

export type RuntimePersistenceSetupState = RuntimePersistenceCapability | { status: 'checking' | 'unchecked' };
export type RuntimePersistenceSetupAction = 'check' | 'enable' | 'sudo' | 'copy' | 'settings' | 'reload'
  | 'disable-guide' | 'check-disable' | 'reload-disable' | 'review-linger-rollback';
export interface RuntimePersistenceSetupConfiguration { requested: boolean; applied: boolean }
export const RUNTIME_PERSISTENCE_WALKTHROUGH = 'devsessioncanvas.dev-session-canvas#runtimePersistence';
export const RUNTIME_PERSISTENCE_DISABLE_WALKTHROUGH = 'devsessioncanvas.dev-session-canvas#runtimePersistenceDisable';

export function supportsLoginIndependentPersistence(): boolean {
  return process.platform === 'linux' && (!vscode.env.remoteName || vscode.env.remoteName === 'ssh-remote');
}

export function runtimePersistenceStatusLabel(state: RuntimePersistenceSetupState | undefined, applied = true): string {
  if (!applied) {
    switch (state?.status) {
      case 'eligible': return vscode.l10n.t('Turning on · Window reload required');
      case 'blocked': return state.reason === 'linger-disabled'
        ? vscode.l10n.t('Turning on · Setup required') : vscode.l10n.t('Turning on · Unavailable');
      case 'unknown': return vscode.l10n.t('Turning on · Could not verify');
      case 'checking': return vscode.l10n.t('Turning on · Checking');
      case 'unsupported': return vscode.l10n.t('Turning on · Best effort');
      default: return vscode.l10n.t('Turning on · Not checked');
    }
  }
  switch (state?.status) {
    case 'eligible': return vscode.l10n.t('Enabled · Environment ready');
    case 'blocked': return vscode.l10n.t('Enabled · Background services unavailable');
    case 'unknown': return vscode.l10n.t('Enabled · Could not verify');
    case 'checking': return vscode.l10n.t('Enabled · Checking');
    case 'unsupported': return vscode.l10n.t('Enabled · Best effort');
    default: return vscode.l10n.t('Enabled · Not checked');
  }
}

export function runtimePersistenceReason(capability: RuntimePersistenceCapability): string {
  switch (capability.reason) {
    case 'linger-disabled': return vscode.l10n.t('Linger is disabled. Agent and Terminal sessions may stop after the last login ends.');
    case 'manager-unavailable': return vscode.l10n.t('The user service manager is unavailable.');
    case 'environment-mismatch': return vscode.l10n.t('The user service manager belongs to a different execution environment.');
    case 'unit-unverified': return vscode.l10n.t('The Supervisor service could not be verified. Existing sessions remain accessible.');
    case 'supervisor-upgrade-required': return vscode.l10n.t('This Supervisor predates login-independent persistence. Existing sessions remain accessible. Finish them before starting sessions with the updated Supervisor; it will not be restarted automatically.');
    case 'unsupported-platform': return vscode.l10n.t('Linger setup is only available on supported Linux hosts.');
    default: return vscode.l10n.t('Could not verify background persistence. Check system service access and try again.');
  }
}

export class RuntimePersistenceSetup implements vscode.Disposable {
  public state: RuntimePersistenceSetupState = { status: 'unchecked' };
  private inspection?: Promise<RuntimePersistenceCapability>;
  private walkthroughContextUpdate: Thenable<unknown> = Promise.resolve();
  private acting = false;
  private output?: vscode.OutputChannel;
  private disposed = false;
  private readonly notified = new Set<string>();

  public constructor(private readonly onChange: () => void,
    private readonly inspect = inspectRuntimePersistenceCapability,
    private readonly getConfiguration: () => RuntimePersistenceSetupConfiguration = () => ({ requested: false, applied: false })) {
    if (!supportsLoginIndependentPersistence()) this.state = { status: 'unsupported', reason: 'unsupported-platform' };
  }

  public dispose(): void { this.disposed = true; this.output?.dispose(); }

  public async refresh(): Promise<RuntimePersistenceCapability> {
    if (!supportsLoginIndependentPersistence()) {
      const result: RuntimePersistenceCapability = { status: 'unsupported', reason: 'unsupported-platform' };
      this.update(result);
      return result;
    }
    if (!vscode.workspace.isTrusted || this.disposed) {
      const result: RuntimePersistenceCapability = { status: 'unknown', reason: 'observation-failed' };
      this.update(result);
      return result;
    }
    if (this.inspection) return this.inspection;
    this.update({ status: 'checking' });
    const pending = this.inspect().catch((): RuntimePersistenceCapability => ({ status: 'unknown', reason: 'observation-failed' }));
    this.inspection = pending;
    try {
      const result = await pending;
      this.update(result);
      return result;
    } finally { if (this.inspection === pending) this.inspection = undefined; }
  }

  public async checkAndNotify(): Promise<void> {
    if (!vscode.workspace.isTrusted || this.disposed) return;
    const result = await this.refresh();
    if (result.status === 'eligible' || result.status === 'unsupported') return;
    const key = `${result.target?.environmentKey}:${result.target?.uid}:${result.reason}`;
    if (this.notified.has(key)) return;
    this.notified.add(key);
    const action = vscode.l10n.t('Configure background persistence');
    const selection = await vscode.window.showWarningMessage(runtimePersistenceReason(result), action);
    if (selection === action && !this.disposed) await vscode.commands.executeCommand(COMMAND_IDS.configureRuntimePersistence);
  }

  public async requireEligible(): Promise<RuntimePersistenceCapability> {
    const result = await this.refresh();
    if (!vscode.workspace.isTrusted || this.disposed || result.status !== 'eligible') {
      void this.checkAndNotify();
      throw new Error(runtimePersistenceReason(result));
    }
    return result;
  }

  public markUnitUnverified(capability: RuntimePersistenceCapability, upgradeRequired = false): void {
    this.update({ ...capability, status: 'unknown', reason: upgradeRequired ? 'supervisor-upgrade-required' : 'unit-unverified' });
  }

  public async show(direction: 'enable' | 'disable' = 'enable'): Promise<void> {
    if (this.acting || this.disposed) return;
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace before configuring background persistence.'));
      return;
    }
    this.acting = true;
    try {
      await vscode.commands.executeCommand('workbench.action.openWalkthrough', direction === 'enable'
        ? RUNTIME_PERSISTENCE_WALKTHROUGH : RUNTIME_PERSISTENCE_DISABLE_WALKTHROUGH, false);
      if (this.disposed || !vscode.workspace.isTrusted) return;
      if (direction === 'enable') await this.checkEnable('check', false);
      else await this.checkDisable('check-disable', false);
    } finally { this.acting = false; }
  }

  public async perform(action: RuntimePersistenceSetupAction): Promise<'reload-required' | 'disable-reload-required' | void> {
    if (action === 'disable-guide') return this.show('disable');
    if (this.acting || this.disposed) return;
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace before configuring background persistence.'));
      return;
    }
    this.acting = true;
    try {
      if (action === 'check' || action === 'reload') return await this.checkEnable(action);
      if (action === 'check-disable' || action === 'reload-disable') return await this.checkDisable(action);
      if (action === 'review-linger-rollback') return await this.reviewLingerRollback();
      if (action === 'settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', `@id:${CONFIG_KEYS.runtimePersistenceEnabled}`);
        return;
      }
      const observation = await this.refresh();
      if (!vscode.workspace.isTrusted || this.disposed) return;
      const target = observation.target;
      if (observation.status !== 'blocked' || observation.reason !== 'linger-disabled' || !target) {
        this.showReport(observation);
        return;
      }
      if (action === 'copy') {
        await vscode.env.clipboard.writeText(runtimeLingerCommand(target));
        void vscode.window.showInformationMessage(vscode.l10n.t('Enable-linger command copied. Nothing was executed.'));
      } else if (action === 'enable' || action === 'sudo') {
        await this.execute(target, action === 'sudo');
      }
    } finally { this.acting = false; }
  }

  private async checkEnable(action: 'check' | 'reload', revealReport = true): Promise<'reload-required' | void> {
    const observation = await this.refresh();
    await this.walkthroughContextUpdate;
    if (this.disposed || !vscode.workspace.isTrusted || this.state !== observation) return;
    const configuration = { ...this.getConfiguration() };
    const result = observation.status === 'eligible'
      ? !configuration.requested ? 'needs-configuration' : !configuration.applied ? 'needs-reload' : 'ready'
      : observation.status === 'blocked' && observation.reason === 'linger-disabled' && observation.target
        ? 'needs-setup' : observation.status;
    this.showReport(observation, configuration, revealReport || (observation.status !== 'eligible' && result !== 'needs-setup'));
    await vscode.commands.executeCommand('setContext', 'devSessionCanvas.runtimePersistence.checkResult', result);
    if (!this.isConfigurationCurrent(configuration) || this.state !== observation) return;
    await vscode.commands.executeCommand('workbench.action.openWalkthrough', {
      category: RUNTIME_PERSISTENCE_WALKTHROUGH,
      step: result === 'needs-configuration' ? 'configuration' : result === 'needs-reload' ? 'apply'
        : result === 'ready' ? 'verifyApplied' : 'enable'
    }, false);
    if (action === 'reload' && result === 'needs-reload' && this.isConfigurationCurrent(configuration)
      && this.state === observation) return 'reload-required';
  }

  private writeReport(lines: string[], reveal = true): void {
    this.output ??= vscode.window.createOutputChannel(vscode.l10n.t('Background persistence'));
    this.output.clear();
    this.output.appendLine(lines.join('\n\n'));
    if (reveal) this.output.show(true);
  }

  private async checkDisable(action: 'check-disable' | 'reload-disable', revealReport = true): Promise<'disable-reload-required' | void> {
    const configuration = { ...this.getConfiguration() };
    const result = configuration.requested ? 'needs-configuration' : configuration.applied ? 'needs-reload' : 'disabled';
    this.writeReport([
      vscode.l10n.t('Turn off Runtime Persistence'),
      configuration.requested ? vscode.l10n.t('Runtime Persistence setting: enabled.')
        : vscode.l10n.t('Runtime Persistence setting: disabled.'),
      configuration.applied ? vscode.l10n.t('Current window: Runtime Persistence is applied.')
        : vscode.l10n.t('Current window: Runtime Persistence is off.'),
      result === 'needs-configuration'
        ? vscode.l10n.t('Open the setting and uncheck Runtime Persistence: Enabled in the effective scope, then check again.')
        : result === 'needs-reload'
          ? vscode.l10n.t('Turning off is pending. This window still uses Runtime Persistence until the mode change is applied.')
          : vscode.l10n.t('Runtime Persistence is off in this window. This does not mean other windows or account services have stopped.'),
      vscode.l10n.t('Cancelling reload does not undo the saved setting. It still applies when the Canvas or window closes or restarts. Recheck the setting to cancel a pending turn-off request.'),
      vscode.l10n.t('This window leaves the shared Canvas. Shared sessions and content are preserved while other enabled windows participate; the last enabled window explicitly turning off clears them and exits the Supervisor.'),
      vscode.l10n.t('Turning off Runtime Persistence does not change system linger. No system commands were run.')
    ], revealReport);
    await vscode.commands.executeCommand('setContext', 'devSessionCanvas.runtimePersistence.disableCheckResult', result);
    if (!this.isConfigurationCurrent(configuration)) return;
    await vscode.commands.executeCommand('workbench.action.openWalkthrough', {
      category: RUNTIME_PERSISTENCE_DISABLE_WALKTHROUGH,
      step: result === 'needs-configuration' ? 'disableConfiguration' : result === 'needs-reload' ? 'disableApply' : 'verifyDisabled'
    }, false);
    if (action === 'reload-disable' && result === 'needs-reload' && this.isConfigurationCurrent(configuration)) {
      return 'disable-reload-required';
    }
  }

  private isConfigurationCurrent(configuration: RuntimePersistenceSetupConfiguration): boolean {
    if (this.disposed || !vscode.workspace.isTrusted) return false;
    const current = this.getConfiguration();
    return current.requested === configuration.requested && current.applied === configuration.applied;
  }

  private async reviewLingerRollback(): Promise<void> {
    const configuration = { ...this.getConfiguration() };
    if (configuration.requested || configuration.applied) {
      await this.checkDisable('check-disable');
      return;
    }
    const observation = await this.refresh();
    if (!this.isConfigurationCurrent(configuration) || this.state !== observation) return;
    const verifiedTarget = observation.status === 'eligible'
      || (observation.status === 'blocked' && observation.reason === 'linger-disabled') ? observation.target : undefined;
    this.writeReport([
      vscode.l10n.t('Optional system linger rollback'),
      vscode.l10n.t('This is not required to turn off Runtime Persistence. Linger affects all user services for this account, not just this extension.'),
      vscode.l10n.t('This extension cannot verify that other windows, workspaces or services no longer need linger. Review dependencies with your administrator before running either command.'),
      ...(verifiedTarget ? [
        vscode.l10n.t('Host: {host}', { host: verifiedTarget.host }),
        vscode.l10n.t('Account: {user} (UID {uid})', { user: verifiedTarget.user, uid: String(verifiedTarget.uid) })
      ] : []),
      ...(observation.status === 'eligible' && verifiedTarget ? [
        vscode.l10n.t('Linger is enabled. These commands are for manual review only; nothing was executed.'),
        vscode.l10n.t('Standard command: {command}', { command: runtimeLingerCommand(verifiedTarget, false, 'disable') }),
        vscode.l10n.t('Administrator command (sudo): {command}', { command: runtimeLingerCommand(verifiedTarget, true, 'disable') })
      ] : [observation.status === 'blocked' && observation.reason === 'linger-disabled'
        ? vscode.l10n.t('Linger is already disabled. No rollback command is needed.') : runtimePersistenceReason(observation)]),
      vscode.l10n.t('After any manual change, run this review again to read the actual system state. Displaying a command does not prove it succeeded.')
    ]);
  }

  private showReport(observation: RuntimePersistenceCapability, configuration = this.getConfiguration(), reveal = true): void {
    const target = observation.target;
    this.writeReport([
      vscode.l10n.t('Background persistence'),
      ...(target ? [
        vscode.l10n.t('Host: {host}', { host: target.host }),
        vscode.l10n.t('Account: {user} (UID {uid})', { user: target.user, uid: String(target.uid) })
      ] : []),
      observation.status === 'eligible'
        ? vscode.l10n.t('Environment ready. Existing executions are not restarted.') : runtimePersistenceReason(observation),
      configuration.requested
        ? vscode.l10n.t('Runtime Persistence setting: enabled.')
        : vscode.l10n.t('Runtime Persistence setting: disabled. Open the setting and enable it to continue.'),
      configuration.applied
        ? vscode.l10n.t('Current window: Runtime Persistence is applied.')
        : vscode.l10n.t('Current window: Runtime Persistence is not applied. After enabling the setting, reload to apply it.'),
      observation.status === 'eligible' && configuration.requested && configuration.applied
        ? vscode.l10n.t('Setup verified for this window. Each Supervisor service is still checked before a new session starts.')
        : vscode.l10n.t('Setup is not complete. Follow the selected guide step, then check again.'),
      ...(observation.status === 'blocked' && observation.reason === 'linger-disabled' && target ? [
        vscode.l10n.t('Standard command: {command}', { command: runtimeLingerCommand(target) }),
        vscode.l10n.t('Administrator command (sudo): {command}', { command: runtimeLingerCommand(target, true) })
      ] : []),
      vscode.l10n.t('Commands run only after confirmation, on the displayed host.'),
      vscode.l10n.t('This is the latest check, not a live monitor. Check again after changing hosts or system settings.')
    ], reveal);
  }

  private async execute(target: RuntimePersistenceTarget, administrator: boolean): Promise<void> {
    const command = runtimeLingerCommand(target, administrator);
    const confirm = vscode.l10n.t('Run in terminal');
    const selection = await vscode.window.showWarningMessage(vscode.l10n.t('Enable linger for this account?'), {
      modal: true,
      detail: [
        vscode.l10n.t('Host: {host}', { host: target.host }),
        vscode.l10n.t('Account: {user} (UID {uid})', { user: target.user, uid: String(target.uid) }),
        vscode.l10n.t('This account’s user services may keep running after logout. Disabling or uninstalling this extension does not turn linger off.'),
        vscode.l10n.t('Command: {command}', { command })
      ].join('\n\n')
    }, confirm);
    if (selection !== confirm || !vscode.workspace.isTrusted || this.disposed) return;
    const current = await this.refresh();
    if (!vscode.workspace.isTrusted || this.disposed || current.status !== 'blocked' || !current.target
      || !sameRuntimePersistenceTarget(target, current.target) || current.reason !== 'linger-disabled') {
      await vscode.window.showWarningMessage(vscode.l10n.t('The target or persistence state changed. Check again before running a command.'));
      return;
    }
    const terminal = vscode.window.createTerminal({
      name: vscode.l10n.t('Configure background persistence'),
      shellPath: '/bin/sh',
      shellArgs: ['-c', command],
      cwd: '/',
      strictEnv: true,
      env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
      isTransient: true
    });
    terminal.show();
    void vscode.window.showInformationMessage(vscode.l10n.t(
      'The command was started in a dedicated terminal. If authorization is required, enter it only there. Check again after it finishes; sending a command does not prove success.'
    ));
  }

  private update(state: RuntimePersistenceSetupState): void {
    if (this.disposed) return;
    this.state = state;
    if (state.status !== 'checking') {
      const setupState = state.status === 'blocked' && state.reason === 'linger-disabled' && state.target
        ? 'needs-setup' : state.status;
      this.walkthroughContextUpdate = vscode.commands.executeCommand('setContext', 'devSessionCanvas.runtimePersistence.setupState', setupState);
    }
    this.onChange();
  }
}
