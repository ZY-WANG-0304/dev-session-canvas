// A real stdio MCP tool: one call waits for an external release. No model/API
// responses or terminal output are fabricated by this fixture.
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const directory = process.argv[2];
let called = false;
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
async function handle(request) {
  if (request.id === undefined) return;
  const reply = result => write({ jsonrpc: '2.0', id: request.id, result });
  if (request.method === 'initialize') return reply({ protocolVersion: request.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: 'dsc-tui-fixture', version: '1.0.0' } });
  if (request.method === 'ping') return reply({});
  if (request.method === 'tools/list') return reply({ tools: [{ name: 'wait_for_release',
    description: 'Wait for the test controller, then return a unique receipt. Call exactly once.',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
  if (request.method !== 'tools/call' || request.params?.name !== 'wait_for_release') {
    return write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method/tool' } });
  }
  if (called) throw new Error('Duplicate fixture tool call');
  called = true;
  const callId = randomUUID();
  await fs.writeFile(path.join(directory, 'tool-start.json'), JSON.stringify({ callId, pid: process.pid,
    startedAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const release = JSON.parse(await fs.readFile(path.join(directory, 'release.json'), 'utf8'));
      if (release.callId !== callId) throw new Error('Wrong release identity');
      const receipt = `receipt_${randomUUID().replaceAll('-', '')}`;
      await fs.writeFile(path.join(directory, 'tool-end.json'), JSON.stringify({ callId, receipt,
        completedAt: Date.now() }), { flag: 'wx', mode: 0o600 });
      return reply({ content: [{ type: 'text', text: receipt }] });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Fixture release deadline exhausted');
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  Promise.resolve().then(() => handle(JSON.parse(line))).catch(() => {
    process.stderr.write('Private TUI tool failed\n'); process.exit(1);
  });
});
