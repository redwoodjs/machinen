#!/usr/bin/env node
/**
 * Strips OrbStack/macOS-specific mount entries from a CRIU checkpoint's
 * mountpoints image file.
 *
 * CRIU image format:
 *   - 4 bytes: IMG_COMMON_MAGIC (0x54564319)
 *   - 4 bytes: image-type magic (e.g., MNTNS_MAGIC)
 *   - Repeated: 4-byte LE payload size + protobuf payload
 */

import fs from "node:fs";

const ORBSTACK_MARKERS = [
  "orbstack",
  "macfuse",
  "grpcfuse",
  "virtiofs",
  "/Users/",
];

function shouldRemoveEntry(buf) {
  const str = buf.toString("latin1");
  return ORBSTACK_MARKERS.some((m) => str.includes(m));
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node patch-checkpoint.mjs <mountpoints-*.img>");
  process.exit(1);
}

const data = fs.readFileSync(file);

// Header: two 4-byte magic numbers
const header = data.subarray(0, 8);
let offset = 8;

// Read entries
const entries = [];
while (offset + 4 <= data.length) {
  const size = data.readUInt32LE(offset);
  if (size === 0 || offset + 4 + size > data.length) break;
  entries.push(data.subarray(offset, offset + 4 + size)); // include the size prefix
  offset += 4 + size;
}

let removedCount = 0;
const kept = [];
for (const entry of entries) {
  const payload = entry.subarray(4); // skip size prefix
  if (shouldRemoveEntry(payload)) {
    removedCount++;
  } else {
    kept.push(entry);
  }
}

fs.writeFileSync(file, Buffer.concat([header, ...kept]));
console.log(`Patched: removed ${removedCount} mount entries, kept ${kept.length}`);
