import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNativeFrame, decodeNativeServerFrame } from '../src/native.ts';
const cases = JSON.parse(
  readFileSync(new URL('./native-vectors.json', import.meta.url), 'utf8')
);
for (const sample of cases)
  assert.equal(
    Boolean(
      decodeNativeFrame(new TextEncoder().encode(sample.frame), sample.now)
    ),
    sample.valid,
    sample.name
  );
assert.equal(
  decodeNativeFrame(new Uint8Array([255, 10]), 1700000000000),
  undefined
);
console.log(`Native protocol: ${cases.length} shared vectors passed`);

const serverCases = JSON.parse(
  readFileSync(new URL('./native-server-vectors.json', import.meta.url), 'utf8')
);
for (const sample of serverCases)
  assert.equal(
    Boolean(decodeNativeServerFrame(new TextEncoder().encode(sample.frame))),
    sample.valid,
    sample.name
  );
console.log(
  `Native server protocol: ${serverCases.length} shared vectors passed`
);
