import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-cli-resolver-'));

try {
  const outfile = path.join(tempDir, 'agentCliResolver.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/agentCliResolver.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const commandBasePath = path.join(tempDir, 'codex');
  const commandCmdPath = `${commandBasePath}.cmd`;
  await writeFile(commandBasePath, '#!/bin/sh\nexit 0\n', 'utf8');
  await writeFile(commandCmdPath, '@echo off\r\nexit /b 0\r\n', 'utf8');

  const require = createRequire(import.meta.url);
  const {
    formatAgentCliResolutionAttemptDescriptor,
    resolveAgentCliCommand
  } = require(outfile);

  assert.equal(
    formatAgentCliResolutionAttemptDescriptor({
      id: 'configured-absolute',
      value: commandBasePath
    }),
    `Configured absolute path: ${commandBasePath}`
  );

  if (process.platform !== 'win32') {
    console.log('agentCliResolver Windows resolution tests skipped on non-Windows platform');
  } else {
    const cachedResolution = await resolveAgentCliCommand({
      provider: 'codex',
      label: 'Codex',
      requestedCommand: 'codex',
      workspaceCwd: tempDir,
      env: {
        ...process.env,
        PATH: tempDir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD'
      },
      cachedResolvedCommand: commandBasePath
    });
    assert.equal(cachedResolution.source, 'cache');
    assert.equal(cachedResolution.resolvedCommand.toLowerCase(), commandCmdPath.toLowerCase());
    assert.equal(cachedResolution.attemptDescriptors.some((attempt) => attempt.id === 'cache'), true);

    const absoluteResolution = await resolveAgentCliCommand({
      provider: 'codex',
      label: 'Codex',
      requestedCommand: commandBasePath,
      workspaceCwd: tempDir,
      env: {
        ...process.env,
        PATH: tempDir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD'
      }
    });
    assert.equal(absoluteResolution.source, 'configured-absolute');
    assert.equal(absoluteResolution.resolvedCommand.toLowerCase(), commandCmdPath.toLowerCase());
    assert.equal(absoluteResolution.attemptDescriptors[0]?.id, 'configured-absolute');

    const envWithOnlyPath = {
      ...process.env,
      Path: tempDir,
      PATHEXT: '.COM;.EXE;.BAT;.CMD'
    };
    delete envWithOnlyPath.PATH;

    const pathCaseInsensitiveResolution = await resolveAgentCliCommand({
      provider: 'codex',
      label: 'Codex',
      requestedCommand: 'codex',
      workspaceCwd: tempDir,
      env: envWithOnlyPath
    });
    assert.equal(pathCaseInsensitiveResolution.source, 'path-env');
    assert.equal(pathCaseInsensitiveResolution.resolvedCommand.toLowerCase(), commandCmdPath.toLowerCase());
    assert.equal(pathCaseInsensitiveResolution.attemptDescriptors.some((attempt) => attempt.id === 'path-env'), true);
  }

  console.log('agentCliResolver tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
