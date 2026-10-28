// Private, non-blocking observer. Never emits instructions or a continuation.
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) process.exit(1);
});
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  const observed = { observedAt: Date.now(), observerPid: process.pid };
  for (const key of ['session_id', 'turn_id', 'hook_event_name', 'cwd', 'prompt',
    'stop_hook_active', 'last_assistant_message', 'error', 'error_details']) {
    if (event[key] !== undefined) observed[key] = event[key];
  }
  fs.appendFileSync(process.argv[2], `${JSON.stringify(observed)}\n`, { mode: 0o600 });
  process.stdout.write('{}\n');
});
