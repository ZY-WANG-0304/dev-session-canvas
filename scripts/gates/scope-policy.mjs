import assert from 'node:assert/strict';
import { jobDependencies, taskKey } from './catalog.mjs';

// A changed input outside this inventory is deliberately full scope. These are
// execution dependencies, not a claim that every file under docs is inert.
export const scopePolicyVersion = 1;
export const documentationConsumers = Object.freeze({
  'docs/UI.md': ['test:theme-color-tokens'],
  'docs/design-docs/canvas-multi-root-workspace-support.md': ['test:theme-color-tokens'],
  'docs/product-specs/canvas-multi-root-workspace-support.md': ['test:theme-color-tokens'],
  'docs/product-specs/canvas-template-feature.md': ['test:canvas-templates'],
  'docs/design-docs/canvas-template-feature.md': ['test:canvas-templates'],
  'docs/exec-plans/active/canvas-template-feature.md': ['test:canvas-templates'],
  'docs/design-docs/template-marketplace.md': ['test:canvas-templates'],
  'docs/design-docs/public-marketplace-release-readiness.md': ['test:release-preflight'],
  'docs/public-preview-release-playbook.md': ['test:release-preflight'],
  'docs/notifier-preview-release-playbook.md': ['test:release-preflight'],
  'docs/support.md': ['test:release-preflight']
});
const docRoots = ['docs/exec-plans/', 'docs/design-docs/', 'docs/workflows/', 'docs/product-specs/'];
const docFiles = ['AGENTS.md', 'ARCHITECTURE.md', 'docs/WORKFLOW.md', 'docs/PLANS.md', 'docs/DESIGN.md',
  'docs/FRONTEND.md', 'docs/PRODUCT_SENSE.md', 'docs/QUALITY_SCORE.md', 'docs/RELIABILITY.md', 'docs/SECURITY.md'];
export function ordinaryDocumentation(file) {
  return !Object.hasOwn(documentationConsumers, file) && (docFiles.includes(file)
    || file.endsWith('.md') && docRoots.some(root => file.startsWith(root)));
}
export function classifyImpact(paths) {
  const domains = new Set(), contracts = new Set(), reasons = [];
  for (const file of [...paths].sort()) {
    assert(typeof file === 'string' && file && !file.startsWith('/') && !file.split('/').includes('..'));
    let domain;
    if (Object.hasOwn(documentationConsumers, file)) {
      domain = 'documentation-contract'; documentationConsumers[file].forEach(id => contracts.add(id));
    } else if (ordinaryDocumentation(file)) domain = 'documentation';
    else if (/^apps\/template-marketplace\/src\//.test(file)) domain = 'marketplace';
    else if (/^packages\/marketplace-shared\/src\//.test(file)) domain = 'marketplace-shared';
    else if (/^extensions\/vscode\/dev-session-canvas-notifier\/src\//.test(file)) domain = 'attention';
    else if (/^packages\/attention-protocol\/(src|tests)\//.test(file)) domain = 'plugin';
    else if (/^extensions\/vscode\/dev-session-canvas\/src\/webview\/.*\.css$/.test(file)) domain = 'presentation';
    else if (/^extensions\/vscode\/dev-session-canvas\/src\/(webview|panel|common|runtime)\//.test(file)) domain = 'plugin';
    else if (/^extensions\/vscode\/dev-session-canvas(?:-notifier)?\/(README\.marketplace\.md|CHANGELOG\.md|images\/)/.test(file)
      || /^(README(?:\.[\w-]+)?\.md|CHANGELOG\.md|LICENSE|PRIVACY\.md)$/.test(file)) domain = 'listing';
    else domain = 'full';
    domains.add(domain); reasons.push({ path: file, domain });
  }
  if (!paths.length) domains.add('documentation');
  return { version: scopePolicyVersion, domains: [...domains].sort(), contracts: [...contracts].sort(), reasons };
}
const marketRegression = /marketplace|canvas-templates|common-dependencies|workspace-relative-paths/;
const attentionRegression = /notifier|attention|ui-copy|extension-manifest|protocol-webview|common-dependencies/;
const attentionSuites = /^(notifier-|ui-copy-locale$|execution-notifications\/)/;
const templateSuites = /^(canvas-entry\/(?:first-template|trusted-templates)|canvas-nodes\/(?:create|layout))/;

export function selectAffectedTasks(all, paths) {
  const impact = classifyImpact(paths), domains = new Set(impact.domains);
  const chosen = new Set();
  const add = task => chosen.add(taskKey(task));
  const full = domains.has('full');
  for (const task of all) {
    if (full || task.job === 'input-contract') { add(task); continue; }
    if (task.job === 'regression' && impact.contracts.includes(task.id)) add(task);
    if ((domains.has('plugin') || domains.has('presentation')) && task.job !== 'marketplace-browser'
      && !(task.job === 'regression' && task.id.includes('marketplace') && !task.id.includes('publish'))) add(task);
    if (domains.has('marketplace') || domains.has('marketplace-shared')) {
      if (['marketplace-browser', 'marketplace-host'].includes(task.job)
        || task.job === 'regression' && (marketRegression.test(task.id) || ['typecheck', 'typecheck:marketplace'].includes(task.id))) add(task);
      if (domains.has('marketplace-shared') && (['webview-function', 'webview-visual'].includes(task.job)
        || task.suite && templateSuites.test(task.suite) || task.job === 'installed-pair')) add(task);
    }
    if (domains.has('attention') && (['webview-function', 'webview-visual', 'installed-pair'].includes(task.job)
      || task.job === 'regression' && (attentionRegression.test(task.id) || ['typecheck', 'typecheck:notifier'].includes(task.id))
      || task.suite && attentionSuites.test(task.suite))) add(task);
    if (domains.has('listing') && (['package-clean', 'installed-pair'].includes(task.job)
      || task.job === 'regression' && /package-vsix|release-preflight|extension-manifest|ui-copy/.test(task.id))) add(task);
  }
  // A job may contain several contract tasks (native load + operation, package
  // build + file list). Producers must remain complete and retain all six assets.
  let changed;
  do {
    changed = false;
    for (const task of all.filter(task => chosen.has(taskKey(task)))) {
      for (const dependency of jobDependencies[task.job] ?? []) for (const producer of all.filter(item => item.job === dependency)) {
        if (!chosen.has(taskKey(producer))) { add(producer); changed = true; }
      }
    }
  } while (changed);
  return { tasks: all.filter(task => chosen.has(taskKey(task))), impact,
    omitted: all.filter(task => !chosen.has(taskKey(task))).map(task => ({ key: taskKey(task), reason: 'outside-affected-modules' })) };
}
