import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'release', 'publish-tag-release.mjs');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-publish-tag-release-'));
const releaseRef = '0123456789abcdef0123456789abcdef01234567';
const version = '1.2.3';

try {
  await writeFixture(tempDir, version);

  const help = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: tempDir,
    encoding: 'utf8'
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /publish\/vX\.Y\.Z/u);

  const invalidTag = runRelease(['--trigger-tag', 'v1.2.3', '--dry-run']);
  assert.notEqual(invalidTag.status, 0);
  assert.match(invalidTag.stderr, /publish\/vX\.Y\.Z/u);

  const versionMismatch = runRelease(['--trigger-tag', 'publish/v1.2.4', '--dry-run']);
  assert.notEqual(versionMismatch.status, 0);
  assert.match(versionMismatch.stderr, /版本 1\.2\.3/u);

  const packageOnly = runRelease([
    '--trigger-tag', `publish/v${version}`,
    '--dry-run',
    '--package-only',
    '--skip-origin-main-check'
  ]);
  assert.equal(packageOnly.status, 0, packageOnly.stderr || packageOnly.stdout);
  assert.match(packageOnly.stdout, new RegExp(`Release version: ${version}`, 'u'));
  assert.match(packageOnly.stdout, new RegExp(`Release ref: ${releaseRef}`, 'u'));
  assert.match(packageOnly.stdout, /planned artifact: extensions\/vscode\/dev-session-canvas-notifier\/dev-session-canvas-notifier-1\.2\.3\.vsix/u);
  assert.match(packageOnly.stdout, /planned artifact: dev-session-canvas-1\.2\.3\.vsix/u);

  const manifestPath = path.join(tempDir, 'release-artifacts', `release-manifest-${version}.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.releaseRef, releaseRef);
  assert.equal(manifest.triggerTag, `publish/v${version}`);
  assert.equal(manifest.finalTag, `v${version}`);
  assert.equal(manifest.status, 'packaged');
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.extension),
    ['notifier', 'main']
  );

  const skipPackage = runRelease([
    '--trigger-tag', `publish/v${version}`,
    '--skip-package',
    '--package-only',
    '--skip-origin-main-check'
  ]);
  assert.notEqual(skipPackage.status, 0);
  assert.match(skipPackage.stderr, /未找到 VSIX/u);

  await writeMainVsixAndManifest(tempDir, version, releaseRef);
  const skipPackageSuccess = runRelease([
    '--trigger-tag', `publish/v${version}`,
    '--skip-package',
    '--package-only',
    '--extension',
    'main',
    '--skip-origin-main-check'
  ]);
  assert.equal(skipPackageSuccess.status, 0, skipPackageSuccess.stderr || skipPackageSuccess.stdout);
  const manifestAfterSkipSuccess = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(
    manifestAfterSkipSuccess.artifacts.map((artifact) => artifact.extension),
    ['notifier', 'main']
  );

  const manifestPathAfterSuccess = path.join(tempDir, 'release-artifacts', `release-manifest-${version}.json`);
  const manifestAfterSuccess = JSON.parse(await readFile(manifestPathAfterSuccess, 'utf8'));
  manifestAfterSuccess.artifacts.find((artifact) => artifact.extension === 'main').sha256 = 'bad-sha';
  await writeFile(manifestPathAfterSuccess, `${JSON.stringify(manifestAfterSuccess, null, 2)}\n`, 'utf8');

  const skipPackageMismatch = runRelease([
    '--trigger-tag', `publish/v${version}`,
    '--skip-package',
    '--package-only',
    '--extension',
    'main',
    '--skip-origin-main-check'
  ]);
  assert.notEqual(skipPackageMismatch.status, 0);
  assert.match(skipPackageMismatch.stderr, /sha256/u);

  console.log('publish-tag-release tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function runRelease(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: tempDir,
    env: {
      ...process.env,
      PATH: `${path.join(tempDir, 'bin')}${path.delimiter}${process.env.PATH || ''}`
    },
    encoding: 'utf8'
  });
}


async function writeMainVsixAndManifest(root, fixtureVersion, fixtureReleaseRef) {
  const zip = new JSZip();
  zip.file(
    'extension/package.json',
    JSON.stringify(
      {
        name: 'dev-session-canvas',
        publisher: 'devsessioncanvas',
        version: fixtureVersion
      },
      null,
      2
    )
  );
  zip.file('extension/readme.md', `release ref ${fixtureReleaseRef}\n`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const vsixPath = path.join(root, `dev-session-canvas-${fixtureVersion}.vsix`);
  await writeFile(vsixPath, buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const manifestPath = path.join(root, 'release-artifacts', `release-manifest-${fixtureVersion}.json`);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: fixtureVersion,
        releaseRef: fixtureReleaseRef,
        artifacts: [
          {
            extension: 'notifier',
            sha256: 'notifier-sha',
            version: fixtureVersion
          },
          {
            extension: 'main',
            sha256,
            version: fixtureVersion
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function writeFixture(root, fixtureVersion) {
  await writeJson(path.join(root, 'package.json'), {
    name: 'dev-session-canvas',
    publisher: 'devsessioncanvas',
    version: fixtureVersion,
    scripts: {
      'publish:marketplaces': 'node fake-publish-marketplaces.js'
    }
  });
  await writeJson(path.join(root, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'package.json'), {
    name: 'dev-session-canvas-notifier',
    publisher: 'devsessioncanvas',
    version: fixtureVersion
  });
  await writeFile(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## ${fixtureVersion}\n\n- fixture\n`, 'utf8');
  await writeFile(
    path.join(root, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'CHANGELOG.md'),
    `# Changelog\n\n## ${fixtureVersion}\n\n- fixture\n`,
    'utf8'
  );
  await writeFile(path.join(root, 'fake-publish-marketplaces.js'), 'process.exit(0);\n', 'utf8');

  const binDir = path.join(root, 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFakeGit(binDir);
}

async function writeJson(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

async function writeFakeGit(binDir) {
  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, 'git.cmd');
    await writeFile(
      commandPath,
      `@echo off
node "%~dp0git-fake.js" %*
`,
      'utf8'
    );
  } else {
    const commandPath = path.join(binDir, 'git');
    await writeFile(commandPath, `#!/usr/bin/env sh
node "$(dirname "$0")/git-fake.js" "$@"
`, {
      encoding: 'utf8',
      mode: 0o755
    });
  }

  await writeFile(
    path.join(binDir, 'git-fake.js'),
    `const args = process.argv.slice(2);
const releaseRef = '${releaseRef}';
if (args[0] === 'rev-parse') {
  const rev = args[1];
  if (rev === 'HEAD' || rev.startsWith('publish/v')) {
    console.log(releaseRef);
    process.exit(0);
  }
  process.exit(1);
}
if (args[0] === 'status' && args[1] === '--porcelain') {
  process.exit(0);
}
if (args[0] === 'fetch') {
  process.exit(0);
}
if (args[0] === 'merge-base') {
  process.exit(0);
}
if (args[0] === 'ls-remote') {
  process.exit(0);
}
if (args[0] === 'tag' || args[0] === 'push') {
  process.exit(0);
}
console.error('unexpected git args: ' + JSON.stringify(args));
process.exit(1);
`,
    'utf8'
  );
}
