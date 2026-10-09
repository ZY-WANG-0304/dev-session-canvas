import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const commonRoot = path.resolve('extensions/vscode/dev-session-canvas/src/common');
const forbiddenPackages = [/^vscode(?:\/|$)/u, /^react(?:\/|$)/u, /^react-dom(?:\/|$)/u, /^node-pty(?:\/|$)/u];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (/\.tsx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function getStaticModuleSpecifiers(sourceFile) {
  const imports = [];
  const add = (specifier, node, syntax) => {
    if (specifier && ts.isStringLiteralLike(specifier)) {
      imports.push({ value: specifier.text, node, syntax });
    }
  };

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier, node, 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node, 'export');
    } else if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
      add(argument, node, 'import-type');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node, 'import-equals');
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const expression = node.expression;
      const isRequire = ts.isIdentifier(expression) && expression.text === 'require';
      const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) {
        add(node.arguments[0], node, isRequire ? 'require' : 'dynamic-import');
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function inspectFile(filePath, source) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const violations = [];
  for (const dependency of getStaticModuleSpecifiers(sourceFile)) {
    if (dependency.value.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filePath), dependency.value);
      const relative = path.relative(commonRoot, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        violations.push(`${path.relative(process.cwd(), filePath)}: ${dependency.syntax} escapes common via ${dependency.value}`);
      }
      continue;
    }
    if (forbiddenPackages.some(pattern => pattern.test(dependency.value))) {
      violations.push(`${path.relative(process.cwd(), filePath)}: ${dependency.syntax} imports forbidden package ${dependency.value}`);
    }
  }
  return violations;
}

// Keep the guard itself honest about type-only, re-export, require and dynamic import syntax.
const fixturePath = path.join(commonRoot, 'boundary-fixture.ts');
const fixtureSource = [
  "import type { HostType } from '../panel/host';",
  "export { value } from '../sidebar/value';",
  "import 'vscode';",
  "const pty = require('node-pty');",
  "import NodePty = require('node-pty');",
  "void import('../webview/value');",
  "type ReactType = import('react').ComponentType;",
  'void pty;'
].join('\n');
const fixtureViolations = inspectFile(fixturePath, fixtureSource);
assert.equal(fixtureViolations.length, 7, `Guard fixture coverage changed: ${fixtureViolations.join('; ')}`);

for (const source of [
  "void import('../panel/testHarness', {});",
  'void import(`../panel/testHarness`);',
  'require(`vscode`);',
  'void import(`../panel/testHarness`, {});'
]) {
  assert.equal(inspectFile(fixturePath, source).length, 1, `Static dependency must be rejected: ${source}`);
}

for (const source of [
  "void import('./protocol', {});",
  'void import(`./protocol`);',
  'require(`@xterm/headless/package.json`);',
  'void import(`./protocol`, {});',
  'void import(moduleName, {});',
  'void import(`../panel/${moduleName}`);',
  'require(moduleName);',
  'require(`${packageName}`);'
]) {
  assert.deepEqual(inspectFile(fixturePath, source), [], `Allowed or non-static dependency: ${source}`);
}

const sourceFiles = await collectSourceFiles(commonRoot);
const violations = [];
for (const filePath of sourceFiles) {
  violations.push(...inspectFile(filePath, await readFile(filePath, 'utf8')));
}

assert.deepEqual(violations, [], `Common dependency boundary violations:\n${violations.join('\n')}`);
console.log(`Common dependency boundary: ${sourceFiles.length} files checked, no violations.`);
