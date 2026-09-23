// Separate entry avoids importing an evaluating top-level-await driver.
// The frozen v1 driver, verifier, assertions and saved failures stay unchanged.
import assert from 'node:assert/strict';
import path from 'node:path';
import { verifySaved } from './native-failure-verifier-v1.mjs';

assert.equal(process.argv.length, 3, 'Usage: node verify-native-failure-v1.mjs <saved-directory>');
const result = await verifySaved(path.resolve(process.argv[2]));
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
