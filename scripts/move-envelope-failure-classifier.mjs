#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean", default: false },
  },
});

const text = positionals.map((path) => readFileSync(path, "utf8")).join("\n");
const infraPattern =
  /EXEC_AGENT_(?:TIMEOUT|UNAVAILABLE)|VsockExec|EPIPE|gvproxy|timed out after|connection reset|broken pipe/i;
const semanticPattern =
  /AssertionError|assert |changed-[a-z-]+|missing-[a-z-]+|unsupported-[a-z-]+|targetPid|loader state refused|PATCH\t[^\t]+\trefused/i;
const classification = infraPattern.test(text)
  ? "infrastructure"
  : semanticPattern.test(text)
    ? "semantic"
    : "semantic";

if (values.json) {
  console.log(JSON.stringify({ classification }, null, 2));
} else {
  console.log(classification);
}
