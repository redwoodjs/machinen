import assert from "node:assert/strict";
const expected = JSON.parse(process.env.MACHINEN_EXPECTED_MEMORY_STATE_JSON ?? "{}");
const actual = await fetch("http://127.0.0.1:3000/state").then((res) => res.json());
assert.deepEqual(actual, expected);
console.log(JSON.stringify({ accepted: true, actual, expected }));
