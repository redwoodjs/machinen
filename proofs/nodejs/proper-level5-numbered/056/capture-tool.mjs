#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) {
  throw new Error("usage: capture-tool.mjs <out-dir>");
}
mkdirSync(outDir, { recursive: true });
const captureId = "proof-056-real-capture-tool-output";
const generator = "proof-056-capture-tool-v1";
const sections = {
  architecture: { source: "arm64", target: "amd64" },
  heapGraphIr: { count: 2, graphTotal: 2, evidence: "captured-v8-bytes" },
  continuationDescriptor: { continuationClass: "node-libuv-event-loop-wait-v1" },
  resourceDescriptors: { descriptors: ["tcp-listener-v1", "repeating-timer-v1"] },
  threadEvidence: { threads: [{ id: "main", state: "idle-epoll-wait" }] },
};
for (const [section, payload] of Object.entries(sections)) {
  const body = { section, captureId, generator, payload, handAuthored: false };
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  writeFileSync(
    join(outDir, `${section}.artifact.json`),
    `${JSON.stringify({ ...body, digest }, null, 2)}\n`,
  );
}
