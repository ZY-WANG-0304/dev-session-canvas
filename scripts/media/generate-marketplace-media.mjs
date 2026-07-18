#!/usr/bin/env node

/**
 * Compatibility entry for the historical marketplace media command.
 *
 * The current recorder is intentionally interactive: an agent drives the real
 * VS Code window with native mouse/keyboard input and captures storyboard
 * frames at scenario checkpoints. This wrapper keeps the old npm script from
 * breaking and forwards explicit subcommands to recording-session.mjs.
 */

import { spawnSync } from 'child_process';
import path from 'path';

const projectRoot = process.cwd();
const recordingScriptPath = path.join(projectRoot, 'scripts', 'media', 'recording-session.mjs');
const args = process.argv.slice(2);

if (args.length > 0) {
  const result = spawnSync(process.execPath, [recordingScriptPath, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

console.log(`Marketplace 预览物料录制现在是交互式流程。

可以通过这个兼容入口转发录制子命令：

  npm run generate:marketplace-media -- start --scenario four-root-attention
  npm run generate:marketplace-media -- record-start --take rootGroups --scene <label>
  npm run generate:marketplace-media -- record-stop
  npm run generate:marketplace-media -- checkpoint <frame-id> --take rootGroups
  npm run generate:marketplace-media -- close

历史 stop 子命令仍会运行旧单宽屏导出；当前正式媒体只由
scripts/media/compose-marketplace-media.mjs 读取 pair manifest 后生成。

完整步骤见 docs/skills/recording-marketplace-media/SKILL.md 和
docs/marketplace-media-scenario.md。
`);
