#!/usr/bin/env node

const fs = require('fs');
const { spawnSync } = require('child_process');

const [settingsPath, eventName, sessionId, promptId, errorMessage] = process.argv.slice(2);

try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const payload = JSON.stringify({
    session_id: sessionId,
    prompt_id: promptId,
    hook_event_name: eventName,
    ...(errorMessage ? { error: errorMessage } : {})
  });
  const groups = settings && settings.hooks && Array.isArray(settings.hooks[eventName])
    ? settings.hooks[eventName]
    : [];
  for (const group of groups) {
    const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (!hook || hook.type !== 'command' || typeof hook.command !== 'string') {
        continue;
      }
      spawnSync(hook.command, {
        shell: true,
        env: process.env,
        input: `${payload}\n`,
        stdio: ['pipe', 'ignore', 'ignore']
      });
    }
  }
} catch {
  // The smoke provider remains usable when generated settings are unavailable.
}
