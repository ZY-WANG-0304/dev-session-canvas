const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function assertOutputIntegrity(lines, expected, receipt) {
  assert(receipt && receipt.count === expected.count && receipt.phase === expected.phase);
  const prefix = `DSC_${expected.nonce}_${expected.phase}_`;
  const actual = lines.filter(line => line.startsWith(prefix));
  const wanted = Array.from({ length: expected.count }, (_, index) => prefix + String(index + 1).padStart(5, '0'));
  assert.deepEqual(actual, wanted, 'Output must retain every original row exactly once and in order');
  const sha256 = crypto.createHash('sha256').update(actual.join('\n')).digest('hex');
  assert.equal(sha256, receipt.sha256, 'Observed content differs from the independent writer');
  return { count: actual.length, sha256, first: actual[0], last: actual.at(-1) };
}
function assertGeometry(observation, expected) {
  assert.equal(observation.request, expected.request, 'Geometry observation is stale');
  assert(observation.observedAt >= expected.after, 'Geometry predates the original resize');
  assert.equal(observation.method, 'original-stdout-fresh-tty-handle');
  assert.equal(observation.cols, expected.cols); assert.equal(observation.rows, expected.rows);
  assert(expected.cols > 0 && expected.rows > 0);
}
function assertNewHost(original, current) {
  assert(original?.start && current?.start, 'Host creation identities are required');
  assert(original.pid !== current.pid || original.start !== current.start, 'Expected a genuinely new Host');
}
module.exports = { assertOutputIntegrity, assertGeometry, assertNewHost };
