import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeCatalog, smokeHostContract } from '../smoke/smoke-catalog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const smokeImplementationFile = 'scripts/smoke/smoke-implementation-map.json';
const designFile = 'docs/references/release-gate-flow-audit/smoke-redesign/coverage-map.json';
const readJSON = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const exact = (actual, expected, label) => {
  assert.equal(new Set(actual).size, actual.length, `${label} contains duplicates`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label} differs from the design`);
};

// This validates traceability, never execution success. It remains dependency
// free so the resolve job can freeze a plan before npm ci or native builds.
export function validateSmokeImplementationMap(map, design = readJSON(designFile)) {
  assert.equal(map.schemaVersion, 1);
  assert.equal(map.scope, 'implementation-traceability-not-execution-acceptance');
  assert.equal(map.designMap, designFile);
  assert.match(map.assertionBaseline, /^[0-9a-f]{40}$/);
  assert(Array.isArray(map.cases) && Array.isArray(map.routes) && Array.isArray(map.assertionReview));
  exact(map.cases.map(item => item.id), design.cases.map(item => item.id), 'Smoke design destinations');
  const cases = new Map(map.cases.map(item => [item.id, item]));
  const suites = new Map(smokeCatalog.map(item => [item.id, item]));
  const subject = destination => {
    const suite = suites.get(destination.suite);
    assert(suite, `Unknown actual smoke suite: ${destination.suite}`);
    assert.equal(destination.file, `tests/vscode-smoke/${suite.testFile}`);
    assert.equal(destination.source, suite.source);
    assert.equal(destination.packaged, suite.packaged);
    assert.equal(destination.diagnosticOnly, Boolean(suite.diagnosticOnly));
    assert.equal(typeof destination.helper, 'string');
    assert.match(destination.helper, /^[A-Za-z_$][\w$]*$/);
    const roles = smokeHostContract(suite.id).subjects[0].roles;
    const role = destination.role ?? 'main';
    assert(roles.includes(role), `Wrong Host role for ${suite.id}/${destination.helper}`);
    const steps = Array.isArray(suite.steps) ? suite.steps : suite.steps?.[role];
    if (destination.step !== undefined && destination.step !== null) {
      assert(steps?.includes(destination.step), `Unplanned step ${suite.id}/${role}/${destination.step}`);
    }
    return suite;
  };
  for (const expected of design.cases) {
    const item = cases.get(expected.id);
    assert(Array.isArray(item.destinations));
    if (expected.status === 'proposed-gap') {
      assert.equal(item.status, 'not-implemented', `Proposed gap cannot claim implementation: ${item.id}`);
      assert.equal(item.destinations.length, 0, `Unimplemented gap cannot count as coverage: ${item.id}`);
      continue;
    }
    assert.equal(item.status, 'implemented-unverified', 'Mappings cannot assert verified acceptance');
    assert(item.destinations.length, `Missing migration destination: ${item.id}`);
    assert.equal(new Set(item.destinations.map(value => JSON.stringify(value))).size, item.destinations.length,
      `Duplicate destinations for ${item.id}`);
    if (expected.proposedPackagedDefault) assert(item.destinations.some(destination => destination.packaged),
      `Packaged coverage was lost: ${item.id}`);
    for (const destination of item.destinations) {
      subject(destination);
      if (!expected.proposedSourceDefault) assert(destination.diagnosticOnly,
        `Focused coverage was promoted to default: ${item.id}`);
    }
  }
  exact(map.routes.map(item => item.legacyRoute), design.currentRoutes.map(item => item.currentScenario), 'Legacy smoke routes');
  for (const expected of design.currentRoutes) {
    const route = map.routes.find(item => item.legacyRoute === expected.currentScenario);
    assert.equal(route.sourceDefault, expected.sourceDefault);
    assert.equal(route.packagedDefault, expected.packagedDefault);
    assert.equal(route.diagnosticOnly, expected.sourceFocusedOnly);
    const destinations = [...new Set(expected.targets.flatMap(id => cases.get(id).destinations.map(item => item.suite)))];
    exact(route.destinations, destinations, `Legacy route ${route.legacyRoute}`);
    if (route.diagnosticOnly) assert(suites.get(route.legacyRoute)?.diagnosticOnly,
      `Original focused entry lost its diagnostic boundary: ${route.legacyRoute}`);
  }
  for (const review of map.assertionReview) {
    assert.equal(review.original.file, 'tests/vscode-smoke/extension-tests.cjs');
    assert(Number.isSafeInteger(review.original.line) && review.original.line > 0);
    assert(review.original.helper && review.original.text && review.reason);
    const suite = suites.get(review.replacement.suite);
    assert(suite, `Unknown assertion replacement suite: ${review.replacement.suite}`);
    assert.equal(review.replacement.file, `tests/vscode-smoke/${suite.testFile}`);
    assert.match(review.replacement.helper, /^[A-Za-z_$][\w$]*$/);
  }
  return map;
}

export function readSmokeImplementationMap() {
  return validateSmokeImplementationMap(readJSON(smokeImplementationFile));
}

// Regression checks real function registrations and call paths with the
// installed TypeScript parser. Static reachability is an audit prerequisite;
// only actual Host case/step receipts can establish runtime coverage.
export async function verifySmokeImplementationSources(map = readSmokeImplementationMap(), {
  readSource = file => readFileSync(path.join(root, file), 'utf8')
} = {}) {
  validateSmokeImplementationMap(map);
  const { default: ts } = await import('typescript');
  const models = new Map();
  const model = file => {
    if (models.has(file)) return models.get(file);
    const ast = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0, `Cannot parse smoke subject ${file}`);
    const functions = new Map(); let registrations;
    const scan = node => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
      if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'module.exports.run'
        && ts.isFunctionExpression(node.right)) functions.set('run', node.right);
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'independentCaseFunctions') registrations = node.initializer;
      ts.forEachChild(node, scan);
    };
    scan(ast);
    const calls = name => {
      const result = new Set();
      const walk = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) result.add(node.expression.text);
        ts.forEachChild(node, walk);
      };
      const fn = functions.get(name); if (fn) walk(fn.body);
      return result;
    };
    const reachable = roots => {
      const visited = new Set();
      const visit = name => { if (visited.has(name)) return; visited.add(name); for (const callee of calls(name)) visit(callee); };
      roots.forEach(visit); return visited;
    };
    const registered = new Set(registrations && ts.isObjectLiteralExpression(registrations)
      ? registrations.properties.map(property => property.name?.getText(ast)) : []);
    const result = { ast, functions, reachable, registered }; models.set(file, result); return result;
  };
  const assertHelper = destination => {
    const suite = smokeCatalog.find(item => item.id === destination.suite);
    const m = model(destination.file);
    assert(m.functions.has(destination.helper), `Missing helper ${destination.file}/${destination.helper}`);
    const roots = suite.kind === 'product-case' ? [suite.prepare, suite.entry, 'assertNoOwnedResizeFailures'] : ['run'];
    if (suite.kind === 'product-case') {
      for (const name of [suite.prepare, suite.entry]) assert(m.registered.has(name), `Unregistered independent helper ${suite.id}/${name}`);
    }
    assert(m.reachable(roots).has(destination.helper), `Unreachable helper ${suite.id}/${destination.helper}`);
    if (destination.step && suite.kind !== 'product-case') {
      const boundaries = new Set();
      const scan = node => {
        if (ts.isCallExpression(node) && ['step', 'stepBoundary'].includes(node.expression.getText(m.ast))
          && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && ts.isStringLiteral(node.arguments[1])) {
          boundaries.add(`${node.arguments[0].text}/${node.arguments[1].text}`);
        }
        ts.forEachChild(node, scan);
      };
      scan(m.functions.get(destination.helper).body);
      for (const status of ['started', 'passed']) assert(boundaries.has(`${destination.step}/${status}`),
        `Missing actual step boundary ${suite.id}/${destination.helper}/${destination.step}/${status}`);
    }
  };
  for (const item of map.cases) for (const destination of item.destinations) assertHelper(destination);
  for (const review of map.assertionReview) assertHelper(review.replacement);
  return { scope: map.scope, designDestinations: map.cases.length,
    mappedDestinations: map.cases.filter(item => item.destinations.length).length,
    unimplemented: map.cases.filter(item => !item.destinations.length).map(item => item.id),
    reviewedAssertionReplacements: map.assertionReview.length };
}
