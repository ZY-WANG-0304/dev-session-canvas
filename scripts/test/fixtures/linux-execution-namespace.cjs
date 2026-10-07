const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [bundlePath, binaryPath, storageDir, mode] = process.argv.slice(2);
const namespace = require(bundlePath);
const canonical = fs.realpathSync(storageDir);
const address = '\0dsc-runtime-owner-' + createHash('sha256')
  .update(JSON.stringify({ uid: process.getuid(), storageDir: canonical })).digest('hex');
const binding = mode === 'native' ? require(binaryPath) : undefined;

process.on('message', async ({ id, command, value }) => {
  if (command === 'exit') process.exit(0);
  if (command === 'finish') { process.disconnect(); return; }
  try {
    let result;
    if (command === 'claim') {
      const claim = binding ? directory => {
        if (directory !== canonical) throw new Error('Expected the canonical storage directory');
        binding.executionClaimNamespace(address);
      } : undefined;
      await namespace.acquireRuntimeSupervisorNamespace(storageDir, claim);
    } else if (command === 'invalid') binding.executionClaimNamespace(value);
    else if (command === 'configure') binding.executionConfigure('namespace-test');
    else if (command === 'inspect') {
      const entry = fs.readFileSync('/proc/net/unix', 'utf8').split('\n')
        .find(line => line.endsWith(` @${address.slice(1)}`));
      if (!entry) throw new Error('The native abstract address is missing');
      const inode = entry.trim().split(/\s+/)[6];
      const fd = fs.readdirSync('/proc/self/fd').find(name => {
        try { return fs.readlinkSync(path.join('/proc/self/fd', name)) === `socket:[${inode}]`; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      if (!fd) throw new Error('The owner does not hold the original abstract socket');
      const flags = fs.readFileSync(path.join('/proc/self/fdinfo', fd), 'utf8').match(/^flags:\s+([0-7]+)$/m);
      if (!flags) throw new Error('Missing owner descriptor flags');
      result = { closeOnExec: (parseInt(flags[1], 8) & 0o2000000) !== 0, address: address.slice(1) };
    } else throw new Error(`Unknown command: ${command}`);
    process.send({ id, ok: true, result });
  } catch (error) {
    process.send({ id, ok: false, message: error.message, code: error.code });
  }
});
process.send({ ready: true, node: process.versions.node, mode });
