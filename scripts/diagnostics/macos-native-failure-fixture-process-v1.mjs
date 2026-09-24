import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function runFixture(config, dependencies = {}) {
  const deps = { connect: (...args) => net.connect(...args), setTimeout, clearTimeout,
    exit: code => process.exit(code), pid: process.pid,
    stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY), ...dependencies };
  return new Promise(resolve => {
    let socket, safety, settled = false, ackStarted = false, pending = '';
    const finish = code => {
      if (settled) return;
      settled = true; deps.clearTimeout(safety); socket?.destroy(); resolve(code); deps.exit(code);
    };
    safety = deps.setTimeout(() => finish(124), 20000);
    try {
      assert.equal(config.scenario, 'U1-6'); assert.match(config.token, /^[a-f0-9]{32}$/);
      socket = deps.connect(config.port, '127.0.0.1');
      socket.once('connect', () => {
        try {
          socket.write(JSON.stringify({ type: 'ready', token: config.token, pid: deps.pid,
            stdinTTY: deps.stdinTTY, stdoutTTY: deps.stdoutTTY }) + '\n', error => { if (error) finish(125); });
        } catch { finish(125); }
      });
      socket.on('error', () => finish(125));
      socket.on('close', () => { if (!settled) finish(125); });
      socket.on('data', data => {
        try {
          if (ackStarted) throw new Error('Control received after abort');
          pending += data;
          const end = pending.indexOf('\n');
          if (end < 0) return;
          const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
          assert.equal(pending, '');
          assert.deepEqual(message, { type: 'abort', token: config.token, pid: deps.pid });
          ackStarted = true;
          socket.end(JSON.stringify({ type: 'abort-ack', token: config.token, pid: deps.pid }) + '\n',
            error => finish(error ? 125 : 0));
        } catch { finish(125); }
      });
    } catch { finish(125); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { config: { type: 'string' }, 'config-json': { type: 'string' } } });
    assert(values.config || values['config-json']);
    const source = values['config-json'] ?? await readFile(values.config, 'utf8');
    await runFixture(JSON.parse(source));
  } catch { process.exit(125); }
}
