import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-cli-selection-'));

try {
  const outfile = path.join(tempDir, 'agentCliSelection.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/agentCliSelection.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    discoverAgentCliCandidates,
    getAgentCliInstallationInfo,
    shouldOfferAgentCliInstallation,
    shortenMiddle
  } = require(outfile);

  assert.equal(shortenMiddle('abcdefghijklmnopqrstuvwxyz', 10), 'abc...wxyz');
  assert.equal(shortenMiddle('/short/path', 64), '/short/path');
  assert.equal(shouldOfferAgentCliInstallation([{ command: 'codex' }]), true);
  assert.equal(shouldOfferAgentCliInstallation([{ command: 'codex', resolvedPath: '/usr/local/bin/codex' }]), false);

  const codexInstallation = getAgentCliInstallationInfo('codex');
  assert.equal(codexInstallation.cliInstallCommand, 'npm i -g @openai/codex');
  assert.equal(codexInstallation.vscodeExtensionId, 'openai.chatgpt');
  assert.equal(codexInstallation.vscodeExtensionUri, 'vscode:extension/openai.chatgpt');

  const claudeInstallation = getAgentCliInstallationInfo('claude');
  assert.equal(claudeInstallation.cliInstallCommand, 'npm install -g @anthropic-ai/claude-code');
  assert.equal(claudeInstallation.vscodeExtensionId, 'anthropic.claude-code');
  assert.equal(claudeInstallation.vscodeExtensionUri, 'vscode:extension/anthropic.claude-code');

  const binDir = path.join(tempDir, 'bin');
  const extensionRoot = path.join(tempDir, 'openai.chatgpt-test-linux-x64');
  const extensionBinDir = path.join(extensionRoot, 'bin', 'linux-x86_64');
  const homeDir = path.join(tempDir, 'home');
  const commonBinDir = path.join(homeDir, '.local', 'bin');
  const codexFromPath = path.join(binDir, executableName('codex'));
  const codexFromExtension = path.join(extensionBinDir, executableName('codex'));
  const codexFromCommonLocation = path.join(commonBinDir, executableName('codex'));

  await mkdir(binDir, { recursive: true });
  await mkdir(extensionBinDir, { recursive: true });
  await mkdir(commonBinDir, { recursive: true });
  await createExecutable(codexFromPath);
  await createExecutable(codexFromExtension);
  await createExecutable(codexFromCommonLocation);

  const candidates = await discoverAgentCliCandidates({
    provider: 'codex',
    configuredCommand: 'codex',
    env: {
      ...process.env,
      PATH: binDir,
      HOME: homeDir,
      PATHEXT: '.COM;.EXE;.BAT;.CMD'
    },
    extensionRoots: [tempDir],
    homeDir,
    maxExtensionScanDepth: 4
  });

  assert.equal(candidates[0]?.source, 'configured');
  assert.equal(candidates[0]?.command, 'codex');
  assert.ok(
    candidates.some((candidate) => candidate.source === 'path-env' && normalizePath(candidate.command) === normalizePath(codexFromPath)),
    'Expected PATH candidate to be discovered.'
  );
  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.source === 'extension-bundled' &&
        normalizePath(candidate.command) === normalizePath(codexFromExtension) &&
        normalizePath(candidate.extensionRoot ?? '') === normalizePath(extensionRoot)
    ),
    'Expected extension-bundled candidate to be discovered.'
  );
  assert.ok(
    candidates.some(
      (candidate) =>
        candidate.source === 'common-location' &&
        normalizePath(candidate.command) === normalizePath(codexFromCommonLocation)
    ),
    'Expected common-location candidate to be discovered.'
  );

  console.log('agent CLI selection tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function createExecutable(filePath) {
  await writeFile(filePath, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o755);
  }
}

function executableName(command) {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}

function normalizePath(filePath) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath;
}
