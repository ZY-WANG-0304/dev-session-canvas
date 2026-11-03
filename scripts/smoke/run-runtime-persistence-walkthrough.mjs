import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import esbuild from 'esbuild';
import { _electron as electron } from 'playwright';

const projectRoot = process.cwd();
assert(process.argv[2], 'Pass a VS Code executable; use xvfb-run on headless Linux.');
const executablePath = path.resolve(process.argv[2]);
const source = path.join(projectRoot, 'extensions/vscode/dev-session-canvas');
const output = path.join(projectRoot, '.debug', `runtime-persistence-walkthrough-${randomUUID()}`);
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const chinese = JSON.parse(await readFile(path.join(source, 'l10n/bundle.l10n.zh-cn.json'), 'utf8'));
const { outputFiles } = await esbuild.build({
  entryPoints: [path.join(source, 'src/panel/runtimePersistenceSetup.ts')],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false
});
const evidence = [];
const fixtureCommands = [
  'fixture.ready', 'fixture.persistence', 'fixture.applied', 'fixture.disableUnknown',
  'devSessionCanvas.disableRuntimePersistence', 'fixture.closed', 'fixture.rollbackReady',
  'fixture.rollbackDisabled', 'fixture.unknown'
];
console.log(`Walkthrough smoke artifacts: ${output}`);

for (const [locale, initiallyReady] of [['en', false], ['zh-cn', false], ['en', true], ['zh-cn', true]]) {
  const runtime = path.join(output, initiallyReady ? `${locale}-ready` : locale);
  const extension = path.join(runtime, 'fixture-extension');
  const userData = path.join(runtime, 'user-data');
  const extensions = path.join(runtime, 'extensions');
  const clipboardFile = path.join(runtime, 'copied-command.txt');
  const reportFile = path.join(runtime, 'report.txt');
  const terminalAttempt = path.join(runtime, 'forbidden-terminal.txt');
  const reloadRequest = path.join(runtime, 'reload-request.txt');
  const commandStateFile = path.join(runtime, 'command-state.json');
  const nls = JSON.parse(await readFile(path.join(source, locale === 'en' ? 'package.nls.json' : 'package.nls.zh-cn.json'), 'utf8'));
  const localize = value => JSON.parse(JSON.stringify(value).replace(/%([^%]+)%/g, (match, key) =>
    nls[key] === undefined ? match : JSON.stringify(nls[key]).slice(1, -1)));
  await Promise.all([mkdir(extension, { recursive: true }), mkdir(path.join(userData, 'User'), { recursive: true }),
    mkdir(extensions, { recursive: true })]);
  await cp(path.join(source, 'walkthroughs'), path.join(extension, 'walkthroughs'), { recursive: true });
  await cp(path.join(source, 'images/icon.png'), path.join(extension, 'icon.png'));
  await writeFile(path.join(extension, 'package.json'), JSON.stringify({
    name: manifest.name, publisher: manifest.publisher, version: '0.0.1', icon: 'icon.png',
    engines: { vscode: '^1.80.0' }, activationEvents: ['onStartupFinished'], main: './extension.cjs',
    contributes: {
      walkthroughs: localize(manifest.contributes.walkthroughs),
      configuration: { properties: { 'devSessionCanvas.runtimePersistence.enabled':
        localize(manifest.contributes.configuration.properties['devSessionCanvas.runtimePersistence.enabled']) } },
      commands: [
        { command: 'fixture.persistence', title: 'Persistence Walkthrough Fixture' },
        { command: 'fixture.ready', title: 'Persistence Fixture Ready' },
        { command: 'fixture.applied', title: 'Persistence Fixture Applied' },
        { command: 'fixture.closed', title: 'Persistence Fixture Closed' },
        { command: 'fixture.disableUnknown', title: 'Persistence Fixture Close Unknown' },
        { command: 'fixture.rollbackReady', title: 'Persistence Fixture Rollback Ready' },
        { command: 'fixture.rollbackDisabled', title: 'Persistence Fixture Rollback Disabled' },
        { command: 'fixture.unknown', title: 'Persistence Fixture Unknown' },
        ...localize(manifest.contributes.commands.filter(entry => entry.command.includes('RuntimePersistence')))
      ],
      keybindings: fixtureCommands.map((command, index) => ({ command, key: `ctrl+alt+shift+${index + 1}` })),
      menus: { commandPalette: manifest.contributes.menus.commandPalette.filter(entry => entry.command.includes('RuntimePersistence')) }
    }
  }));
  await writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'window.dialogStyle': 'custom', 'window.titleBarStyle': 'custom', 'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off',
    'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.enableExperiments': false,
    'workbench.welcomePage.walkthroughs.openOnInstall': false, 'chat.disableAIFeatures': true
  }));
  await writeFile(path.join(extension, 'extension.cjs'), `
    const vscode = require('vscode');
    const fs = require('node:fs');
    const messages = ${JSON.stringify(locale === 'zh-cn' ? chinese : {})};
    const facade = { workspace: vscode.workspace, commands: vscode.commands,
      l10n: { t: (message, parameters = {}) => (messages[message] ?? message)
        .replace(/\{([^}]+)\}/g, (_, key) => parameters[key] ?? '{' + key + '}') },
      env: { remoteName: vscode.env.remoteName, clipboard: { writeText: async text => fs.writeFileSync(${JSON.stringify(clipboardFile)}, text) } },
      window: {
        showInformationMessage: (...args) => vscode.window.showInformationMessage(...args),
        showWarningMessage: (...args) => vscode.window.showWarningMessage(...args),
        createOutputChannel: name => {
          const channel = vscode.window.createOutputChannel(name);
          return { clear: () => channel.clear(), show: focus => channel.show(focus), dispose: () => channel.dispose(),
            appendLine: text => { fs.writeFileSync(${JSON.stringify(reportFile)}, text); channel.appendLine(text); } };
        },
        createTerminal: () => {
          fs.writeFileSync(${JSON.stringify(terminalAttempt)}, 'forbidden');
          throw new Error('Real terminals and system configuration are forbidden in this UI fixture.');
        }
      }
    };
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', ${JSON.stringify(outputFiles[0].text)})(
      name => name === 'vscode' ? facade : require(name), loaded, loaded.exports);
    exports.activate = context => {
      let commandSequence = 0;
      const registerCommand = (command, handler) => vscode.commands.registerCommand(command, async (...args) => {
        const sequence = ++commandSequence;
        fs.writeFileSync(${JSON.stringify(commandStateFile)}, JSON.stringify({ command, sequence, pending: true }));
        try { return await handler(...args); }
        finally { fs.writeFileSync(${JSON.stringify(commandStateFile)}, JSON.stringify({ command, sequence, pending: false })); }
      });
      const target = { uid: 1000000001, user: 'user-with-a-long-name', host: 'remote-workstation', environmentKey: 'a'.repeat(64) };
      let observation = ${initiallyReady ? "{ status: 'eligible', target }" : "{ status: 'blocked', reason: 'linger-disabled', target }"};
      let applied = false;
      const controller = new loaded.exports.RuntimePersistenceSetup(() => {}, async () => observation, () => ({
        requested: vscode.workspace.getConfiguration().get('devSessionCanvas.runtimePersistence.enabled', false), applied
      }));
      context.subscriptions.push(controller,
        registerCommand('fixture.persistence', () => controller.show()),
        registerCommand('devSessionCanvas.configureRuntimePersistence', () => controller.show()),
        registerCommand('devSessionCanvas.disableRuntimePersistence', () => controller.perform('disable-guide')),
        registerCommand('fixture.ready', async () => { observation = { status: 'eligible', target }; await controller.show(); }),
        registerCommand('fixture.applied', async () => { applied = true; await controller.show(); }),
        registerCommand('fixture.closed', async () => { applied = false; await controller.show('disable'); }),
        registerCommand('fixture.disableUnknown', async () => {
          observation = { status: 'unknown', reason: 'observation-failed' }; await controller.refresh(); await controller.show('disable');
        }),
        registerCommand('fixture.rollbackReady', async () => {
          observation = { status: 'eligible', target }; await controller.perform('review-linger-rollback');
        }),
        registerCommand('fixture.rollbackDisabled', async () => {
          observation = { status: 'blocked', reason: 'linger-disabled', target }; await controller.perform('review-linger-rollback');
        }),
        registerCommand('fixture.unknown', async () => { observation = { status: 'unknown', reason: 'observation-failed' }; await controller.show(); }));
      for (const [command, action] of [
        ['checkRuntimePersistence', 'check'], ['enableRuntimePersistenceLinger', 'enable'],
        ['enableRuntimePersistenceLingerWithSudo', 'sudo'], ['copyRuntimePersistenceLingerCommand', 'copy'],
        ['openRuntimePersistenceSetting', 'settings'], ['reloadRuntimePersistence', 'reload'],
        ['checkRuntimePersistenceDisabled', 'check-disable'], ['reloadRuntimePersistenceDisabled', 'reload-disable'],
        ['reviewRuntimePersistenceLingerRollback', 'review-linger-rollback']
      ]) context.subscriptions.push(registerCommand('devSessionCanvas.__internal.' + command, async () => {
        const result = await controller.perform(action);
        if (result === 'reload-required' || result === 'disable-reload-required') fs.writeFileSync(${JSON.stringify(reloadRequest)}, result);
      }));
      void vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar').then(() => controller.show());
    };
  `);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.VSCODE_IPC_HOOK_CLI;
  const application = await electron.launch({
    executablePath, timeout: 60000, env: environment,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--skip-welcome', '--skip-release-notes',
      '--disable-crash-reporter', '--password-store=basic', '--disable-updates',
      '--disable-workspace-trust', '--new-window', `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`, `--extensionDevelopmentPath=${extension}`]
  });
  try {
    const page = await application.firstWindow({ timeout: 60000 });
    page.setDefaultTimeout(15000);
    const walkthrough = page.locator('.gettingStarted.showDetails');
    const dialog = page.locator('.monaco-dialog-box');
    const translate = text => locale === 'zh-cn' ? chinese[text] ?? text : text;
    const step = name => walkthrough.locator(`[data-step-id$="#${name}"]`);
    const waitForSelectedStep = name => page.waitForFunction(stepName => {
      const selected = document.querySelector(`[data-step-id$="#${stepName}"]`);
      return selected?.getAttribute('aria-expanded') === 'true';
    }, name);
    const selectStep = async name => {
      const selected = step(name);
      if (await selected.getAttribute('aria-expanded') !== 'true') await selected.locator('.step-title').click();
      await selected.locator('.step-description-container').waitFor({ state: 'visible' });
    };
    const hidePanel = async () => {
      if (await page.locator('.part.panel').evaluate(element => element.clientHeight > 0)) {
        await page.keyboard.press('Control+j');
      }
    };
    const waitForCommand = async (afterSequence = -1, expectedCommand) => {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const state = await readFile(commandStateFile, 'utf8').then(JSON.parse).catch(() => ({ sequence: 0, pending: false }));
        if (!state.pending && state.sequence > afterSequence) {
          if (expectedCommand) assert.equal(state.command, expectedCommand, 'The palette must execute the requested command.');
          return state.sequence;
        }
        await page.waitForTimeout(50);
      }
      assert.fail('The previous fixture command did not finish.');
    };
    const runFixture = async identifier => {
      const before = await waitForCommand();
      const index = fixtureCommands.indexOf(identifier);
      assert(index >= 0, 'Only known fixture commands may be dispatched.');
      await page.keyboard.press(`Control+Alt+Shift+${index + 1}`);
      await waitForCommand(before, identifier);
    };
    const resize = async width => {
      await application.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows().find(candidate => candidate.isVisible()).setSize(size, 800);
      }, width);
      await page.waitForTimeout(300);
    };
    const capture = async stage => {
      for (const width of [1280, 640]) {
        await resize(width);
        const surface = stage.includes('confirm') ? dialog : walkthrough;
        await surface.waitFor({ state: 'visible' });
        const geometry = await surface.locator('.monaco-button:visible').evaluateAll(elements => elements.map(element => {
          const bounds = element.getBoundingClientRect();
          return { label: element.textContent, left: bounds.left, right: bounds.right,
            viewport: innerWidth, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        }));
        assert(geometry.length > 0);
        for (const button of geometry) {
          assert(button.left >= 0 && button.right <= button.viewport + 1, `${stage}: button outside viewport`);
          assert(button.scrollWidth <= button.clientWidth + 1, `${stage}: clipped label ${button.label}`);
        }
        assert.equal(await surface.locator('input:visible').count(), 0);
        evidence.push({ locale, stage, width, buttons: geometry });
        await page.screenshot({ path: path.join(runtime, `${stage}-${width}.png`) });
      }
      await resize(1280);
    };
    await walkthrough.waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await dialog.count(), 0);
    if (initiallyReady) {
      await waitForSelectedStep('configuration');
      assert.equal(await step('environment').count(), 0);
      assert.equal(await step('enable').count(), 1);
      assert.equal(await step('enable').getAttribute('aria-checked'), 'true', 'First opening on a ready host must check off background services without user input.');
      assert.equal(await step('configuration').getAttribute('aria-checked'), 'false');
      assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'false');
      assert.equal(await page.locator('.part.panel').evaluate(element => element.clientHeight > 0), false);
      assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /Environment ready/ : /环境已就绪/);
      await capture('ready-on-open');
      await selectStep('enable');
      await capture('background-already-ready');
      await assert.rejects(readFile(terminalAttempt), { code: 'ENOENT' });
      await assert.rejects(readFile(reloadRequest), { code: 'ENOENT' });
      console.log(`PASS ${locale}: fresh ready host opens on configuration, with background services retained and checked automatically.`);
      continue;
    }
    await waitForSelectedStep('enable');
    await page.waitForFunction(() => document.querySelector('.gettingStarted [data-step-id$="#enable"] .step-description-container')?.clientHeight > 0);
    assert.equal(await step('environment').count(), 0, 'Environment checks must not occupy a guide step.');
    assert.equal(await step('enable').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('.part.panel').evaluate(element => element.clientHeight > 0), false,
      'The automatic setup check must not open Output.');
    await page.waitForFunction(() => document.querySelectorAll('.gettingStarted iframe').length > 0);
    await page.waitForTimeout(500);
    const expectedMedia = locale === 'en' ? 'A change to this account' : '这是一项账号级变更';
    assert((await Promise.all(page.frames().map(frame => frame.locator('body').innerText().catch(() => ''))))
      .some(text => text.includes(expectedMedia)), 'The packaged localized Markdown media must render.');
    assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'false', 'Host check must not claim setup succeeded.');
    assert.match(await readFile(reportFile, 'utf8'), /remote-workstation[\s\S]*1000000001/);
    await step('enable').getByText(locale === 'en' ? 'check again / view details' : '重新检查 / 查看详情', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.part.panel')?.clientHeight > 0);
    assert.match(await readFile(reportFile, 'utf8'), /remote-workstation[\s\S]*1000000001/);
    await page.screenshot({ path: path.join(runtime, 'report-1280.png') });
    await hidePanel();
    assert.equal(await step('enable').getAttribute('aria-expanded'), 'true');
    await capture('enable');
    await step('enable').getByText(locale === 'en' ? 'copy the command' : '复制命令', { exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await readFile(clipboardFile, 'utf8'), '/usr/bin/loginctl --no-ask-password enable-linger 1000000001');
    await step('enable').locator('.monaco-button').click();
    await dialog.getByRole('button', { name: translate('Run in terminal'), exact: true }).waitFor();
    assert.match(await dialog.innerText(), /remote-workstation[\s\S]*1000000001/);
    await capture('confirm');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await step('enable').getByText(locale === 'en' ? 'use sudo…' : '使用 sudo…', { exact: true }).click();
    await dialog.waitFor({ state: 'visible' });
    assert.match(await dialog.innerText(), /\/usr\/bin\/sudo \/usr\/bin\/loginctl/);
    await capture('sudo-confirm');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await selectStep('verifyApplied');
    await capture('verify');
    await step('verifyApplied').locator('.monaco-button').click();
    await waitForSelectedStep('enable');
    await runFixture('fixture.ready');
    await waitForSelectedStep('configuration');
    assert.equal(await step('enable').count(), 1, 'Ready background services must remain visible.');
    assert.equal(await step('enable').getAttribute('aria-checked'), 'true', 'Opening a ready environment must automatically check off background services.');
    assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /Environment ready/ : /环境已就绪/);
    assert.equal(await step('configuration').getAttribute('aria-checked'), 'false');
    assert.equal(await step('apply').getAttribute('aria-checked'), 'false');
    assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'false', 'Linger alone must not complete setup.');
    await hidePanel();
    await capture('configuration');
    await step('configuration').locator('.monaco-button').click();
    const checkbox = page.getByRole('checkbox', { name: 'devSessionCanvas.runtimePersistence.enabled', exact: true });
    await checkbox.waitFor({ state: 'visible' });
    assert.equal(await checkbox.getAttribute('aria-checked'), 'false');
    await page.screenshot({ path: path.join(runtime, 'setting-1280.png') });
    await checkbox.click();
    await page.waitForFunction(() => document.querySelector('[data-key="devSessionCanvas.runtimePersistence.enabled"] [role="checkbox"]')?.getAttribute('aria-checked') === 'true');
    let settingSaved = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const settings = await readFile(path.join(userData, 'User/settings.json'), 'utf8');
      settingSaved = /"devSessionCanvas\.runtimePersistence\.enabled"\s*:\s*true/.test(settings);
      if (settingSaved) break;
      await page.waitForTimeout(100);
    }
    assert(settingSaved, 'Wait for native Settings to persist its debounced edit before closing it.');
    await page.keyboard.press('Escape');
    await runFixture('fixture.persistence');
    await waitForSelectedStep('apply');
    assert.equal(await step('configuration').getAttribute('aria-checked'), 'true');
    assert.equal(await step('apply').getAttribute('aria-checked'), 'false');
    assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'false', 'A saved setting is not an applied mode.');
    await hidePanel();
    await capture('apply');
    await step('apply').locator('.monaco-button').click();
    await page.waitForTimeout(500);
    assert.equal(await readFile(reloadRequest, 'utf8'), 'reload-required');
    assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'false', 'Requesting reload must not mark setup applied.');
    await runFixture('fixture.applied');
    await waitForSelectedStep('verifyApplied');
    assert.equal(await step('verifyApplied').getAttribute('aria-checked'), 'true');
    assert.equal(await step('apply').getAttribute('aria-checked'), 'true');
    assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /Setup verified for this window/ : /当前窗口配置验证通过/);
    await page.screenshot({ path: path.join(runtime, 'ready-1280.png') });
    await step('verifyApplied').getByText(locale === 'en' ? 'turn-off guide' : '关闭引导', { exact: true }).click();
    await waitForSelectedStep('disableConfiguration');
    assert.equal(await step('disableReview').count(), 0, 'Turn-off checks run automatically, not as a separate step.');
    assert.equal(await step('verifyDisabled').getAttribute('aria-checked'), 'false');
    await runFixture('fixture.disableUnknown');
    await waitForSelectedStep('disableConfiguration');
    assert.equal(await step('verifyDisabled').getAttribute('aria-checked'), 'false');
    await hidePanel();
    await capture('disable-configuration');
    await step('disableConfiguration').locator('.monaco-button').click();
    await checkbox.waitFor({ state: 'visible' });
    assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
    await checkbox.click();
    let settingOffSaved = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const settings = await readFile(path.join(userData, 'User/settings.json'), 'utf8');
      settingOffSaved = !/"devSessionCanvas\.runtimePersistence\.enabled"\s*:\s*true/.test(settings);
      if (settingOffSaved) break;
      await page.waitForTimeout(100);
    }
    assert(settingOffSaved, 'Wait for the native turn-off setting to be saved.');
    await page.keyboard.press('Escape');
    await runFixture('devSessionCanvas.disableRuntimePersistence');
    await waitForSelectedStep('disableApply');
    assert.equal(await step('disableConfiguration').getAttribute('aria-checked'), 'true');
    assert.equal(await step('verifyDisabled').getAttribute('aria-checked'), 'false');
    assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /Turning off is pending/ : /正在等待应用关闭请求/);
    await hidePanel();
    await capture('disable-apply');
    await step('disableApply').locator('.monaco-button').click();
    await page.waitForTimeout(500);
    assert.equal(await readFile(reloadRequest, 'utf8'), 'disable-reload-required');
    assert.equal(await step('verifyDisabled').getAttribute('aria-checked'), 'false', 'A turn-off request is not an applied shutdown.');
    await runFixture('fixture.closed');
    await waitForSelectedStep('verifyDisabled');
    assert.equal(await step('verifyDisabled').getAttribute('aria-checked'), 'true');
    assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /Runtime Persistence is off in this window/ : /当前窗口已关闭 Runtime Persistence/);
    await hidePanel();
    await capture('disable-verify');
    await step('verifyDisabled').getByText(locale === 'en' ? 'review system linger rollback' : '查看系统 linger 撤销说明', { exact: true }).click();
    await page.waitForTimeout(300);
    assert(!((await readFile(reportFile, 'utf8')).includes('disable-linger')), 'An unknown target must not offer a rollback command.');
    await runFixture('fixture.rollbackReady');
    const rollbackReport = await readFile(reportFile, 'utf8');
    assert.match(rollbackReport, /remote-workstation[\s\S]*1000000001/);
    assert.match(rollbackReport, /\/usr\/bin\/loginctl --no-ask-password disable-linger 1000000001/);
    assert.match(rollbackReport, locale === 'en' ? /nothing was executed/ : /未执行任何命令/);
    await page.screenshot({ path: path.join(runtime, 'linger-rollback-1280.png') });
    await runFixture('fixture.rollbackDisabled');
    assert.match(await readFile(reportFile, 'utf8'), locale === 'en' ? /already disabled/ : /Linger 已关闭/);
    await runFixture('fixture.unknown');
    await waitForSelectedStep('enable');
    assert.equal(await step('enable').count(), 1);
    const unknown = await readFile(reportFile, 'utf8');
    assert(!unknown.includes('enable-linger'));
    assert(!unknown.includes('remote-workstation'), 'Unknown result must not retain an old target.');
    await page.screenshot({ path: path.join(runtime, 'unknown-1280.png') });
    await assert.rejects(readFile(terminalAttempt), { code: 'ENOENT' });
    console.log(`PASS ${locale}: automatic opening checks, visible completed background step, native setting toggle, pending reload, injected applied modes, manual rollback reports, confirmations and unknown states.`);
  } catch (error) {
    const page = await application.firstWindow();
    await page.screenshot({ path: path.join(runtime, 'failure.png') });
    await writeFile(path.join(runtime, 'failure.html'), await page.content());
    throw error;
  } finally {
    await writeFile(path.join(output, 'geometry.json'), JSON.stringify(evidence, null, 2));
    await application.close();
  }
}
console.log('Native walkthrough smoke passed with injected capabilities/translations; no real system changes.');
