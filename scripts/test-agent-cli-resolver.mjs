import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

if (process.platform !== 'win32') {
  console.log('agentCliResolver tests skipped on non-Windows platform');
  process.exit(0);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-cli-resolver-'));

try {
  const outfile = path.join(tempDir, 'agentCliResolver.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/agentCliResolver.ts')],
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
  const { resolveAgentCliCommand } = require(outfile);

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

  console.log('agentCliResolver tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
