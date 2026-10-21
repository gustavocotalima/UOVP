import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const results = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(results.success, true, "Integration tests must pass.");
assert.ok(results.numTotalTests > 0, "Integration tests must actually run.");
assert.equal(results.numPendingTests, 0, "Integration tests must not be skipped.");
assert.equal(results.numTodoTests ?? 0, 0, "Integration tests must not be left as TODO.");
console.log(`${results.numPassedTests} integration tests passed without skips.`);
