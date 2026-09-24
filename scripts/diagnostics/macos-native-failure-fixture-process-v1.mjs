import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { parseArgs } from 'node:util';

export async function runFixture(config) {
  assert.equal(config.scenario, 'U1-6');
  const safety = setTimeout(() => process.exit(124), config.fixtureBudgetMs ?? 20000);
  const socket = net.connect(config.port, '127.0.0.1');
  let pending = '';
  let settled = false;
  const finish = (code, message) => {
    if (settled) return;
    settled = true;
    clearTimeout(safety);
    if (message) socket.end(`${JSON.stringify(message)}\n`);
    else socket.end();
    socket.once('close', () => { process.exitCode = code; });
  };
  socket.once('connect', () => socket.write(JSON.stringify({
    type: 'ready', token: config.token, pid: process.pid,
    stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY)
  }) + '\n'));
  socket.on('error', () => finish(125));
  socket.on('data', data => {
    pending += data;
    for (let end; (end = pending.indexOf('\n')) >= 0;) {
      const message = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      assert.equal(message.token, config.token);
      assert.equal(message.pid, process.pid);
      if (message.type === 'go') finish(1);
      else if (message.type === 'abort') finish(0, { type: 'abort-ack', token: config.token, pid: process.pid });
      else finish(1);
    }
  });
}

if (process.argv[1]?.endsWith('macos-native-failure-fixture-process-v1.mjs')) {
  const { values } = parseArgs({ options: { config: { type: 'string' }, 'config-json': { type: 'string' } } });
  if (values.config || values['config-json']) {
    try {
      const source = values['config-json'] ?? await readFile(values.config, 'utf8');
      await runFixture(JSON.parse(source));
    } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
  } else {
    console.error('Specify --config or --config-json');
    process.exitCode = 1;
  }
}
