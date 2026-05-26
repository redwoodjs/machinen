#!/usr/bin/env node
const expected = process.argv[2] || process.env.MACHINEN_NODE_APP_EXPECTED_OUTPUT || "node-http-ok";
const payload = {
  workload: "http-server",
  expected,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  ok: true,
};
console.log(expected);
console.error(JSON.stringify(payload));
