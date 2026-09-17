import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'release', 'release-preflight.mjs');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-release-preflight-'));
const version = '1.2.3';

try {
  await writeFixture(tempDir, version);

  const valid = runPreflight();
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.match(valid.stdout, new RegExp(`v${version}`, 'u'));

  const verificationLogPath = path.join(tempDir, 'verification-commands.log');
  await writeFakeNpm(path.join(tempDir, 'bin'));
  const fullVerification = runPreflight(['--verify'], {
    PATH: `${path.join(tempDir, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
    RELEASE_PREFLIGHT_TEST_LOG: verificationLogPath
  });
  assert.equal(fullVerification.status, 0, fullVerification.stderr || fullVerification.stdout);
  assert.deepEqual((await readFile(verificationLogPath, 'utf8')).trim().split(/\r?\n/u), [
    'run test:release-preflight',
    'run test:release-preflight-workflow',
    'run test',
    'run validate:clean-checkout:vsix -- --ref HEAD'
  ]);

  await writeFile(
    path.join(tempDir, 'extensions', 'vscode', 'dev-session-canvas', 'CHANGELOG.md'),
    `# Changelog\n\n## ${version}\n\n- 发布准备分支仍需重新执行版本同步后的完整分层 gate\n`,
    'utf8'
  );
  const internalReleaseNote = runPreflight();
  assert.notEqual(internalReleaseNote.status, 0);
  assert.match(internalReleaseNote.stderr, /发布准备/u);

  await writeFixture(tempDir, version);
  await rm(path.join(tempDir, 'docs', 'release-contracts', `v${version}.md`));
  const missingContract = runPreflight();
  assert.notEqual(missingContract.status, 0);
  assert.match(missingContract.stderr, /缺少发布契约/u);

  await writeFixture(tempDir, version);
  await writeJson(path.join(tempDir, 'package-lock.json'), {
    lockfileVersion: 3,
    packages: {
      '': {
        version: '1.2.4'
      }
    }
  });
  const lockfileMismatch = runPreflight();
  assert.notEqual(lockfileMismatch.status, 0);
  assert.match(lockfileMismatch.stderr, /package-lock\.json 版本 1\.2\.4/u);

  await writeFixture(tempDir, version);
  await writeFile(
    path.join(tempDir, 'docs', 'release-contracts', `v${version}.md`),
    `# v${version} 发布契约\n\n## 发布范围\n\n- fixture\n`,
    'utf8'
  );
  const incompleteContract = runPreflight();
  assert.notEqual(incompleteContract.status, 0);
  assert.match(incompleteContract.stderr, /用户 release notes/u);

  console.log('release-preflight tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function runPreflight(args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, '--version', version, ...args], {
    cwd: tempDir,
    env: {
      ...process.env,
      ...extraEnv
    },
    encoding: 'utf8'
  });
}

async function writeFakeNpm(binDir) {
  await mkdir(binDir, { recursive: true });
  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'npm.cmd'),
      '@echo off\r\necho %*>> "%RELEASE_PREFLIGHT_TEST_LOG%"\r\nexit /b 0\r\n',
      'utf8'
    );
    return;
  }
  await writeFile(
    path.join(binDir, 'npm'),
    '#!/usr/bin/env sh\necho "$*" >> "$RELEASE_PREFLIGHT_TEST_LOG"\nexit 0\n',
    { encoding: 'utf8', mode: 0o755 }
  );
}

async function writeFixture(root, fixtureVersion) {
  await writeJson(path.join(root, 'package.json'), {
    name: 'dev-session-canvas-workspace',
    private: true,
    version: fixtureVersion
  });
  await writeJson(path.join(root, 'package-lock.json'), {
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'dev-session-canvas-workspace',
        version: fixtureVersion
      }
    }
  });
  await writeJson(path.join(root, 'extensions', 'vscode', 'dev-session-canvas', 'package.json'), {
    name: 'dev-session-canvas',
    version: fixtureVersion
  });
  await writeJson(path.join(root, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'package.json'), {
    name: 'dev-session-canvas-notifier',
    version: fixtureVersion
  });
  await writeFile(
    path.join(root, 'extensions', 'vscode', 'dev-session-canvas', 'CHANGELOG.md'),
    `# Changelog\n\n## ${fixtureVersion} - Fixture release\n\n- User-facing fixture highlight\n`,
    'utf8'
  );
  await writeFile(
    path.join(root, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'CHANGELOG.md'),
    `# Changelog\n\n## ${fixtureVersion}\n\n- User-facing notifier fixture\n`,
    'utf8'
  );
  await mkdir(path.join(root, 'docs', 'release-contracts'), { recursive: true });
  await writeFile(
    path.join(root, 'docs', 'release-contracts', `v${fixtureVersion}.md`),
    `# v${fixtureVersion} 发布契约

## 发布范围

- Fixture feature scope.

## 用户 release notes

- Fixture user promise.

## 文档清单

- \`extensions/vscode/dev-session-canvas/README.marketplace.md\`
- \`extensions/vscode/dev-session-canvas-notifier/README.marketplace.md\`
- \`docs/public-preview-release-playbook.md\`
- \`docs/notifier-preview-release-playbook.md\`
- \`docs/support.md\`
- \`docs/design-docs/public-marketplace-release-readiness.md\`

## 已知限制

- Fixture limitation.

## 验证范围

- Fixture targeted validation.
`,
    'utf8'
  );
  for (const documentPath of [
    'extensions/vscode/dev-session-canvas/README.marketplace.md',
    'extensions/vscode/dev-session-canvas-notifier/README.marketplace.md',
    'docs/public-preview-release-playbook.md',
    'docs/notifier-preview-release-playbook.md',
    'docs/support.md',
    'docs/design-docs/public-marketplace-release-readiness.md'
  ]) {
    const filePath = path.join(root, documentPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'fixture documentation\n', 'utf8');
  }
}

async function writeJson(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}
