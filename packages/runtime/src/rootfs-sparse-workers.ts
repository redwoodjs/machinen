export const SPARSE_GUNZIP_WORKER = String.raw`
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

const [sibling, dst] = process.argv.slice(1);
const fd = openSync(dst, "w");
const hash = createHash("sha256");
let offset = 0;

function isAllZero(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

try {
  const gunzip = createReadStream(sibling).pipe(createGunzip());
  for await (const chunk of gunzip) {
    hash.update(chunk);
    if (!isAllZero(chunk)) {
      writeSync(fd, chunk, 0, chunk.length, offset);
    }
    offset += chunk.length;
  }
  ftruncateSync(fd, offset);
  closeSync(fd);
  console.log(hash.digest("hex"));
} catch (err) {
  try { closeSync(fd); } catch {}
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
}
`;

export const SPARSE_ZSTD_WORKER = String.raw`
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";

const [zstd, sibling, dst] = process.argv.slice(1);
const fd = openSync(dst, "w");
const hash = createHash("sha256");
let offset = 0;
let stderr = "";

function isAllZero(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

try {
  const child = spawn(zstd, ["-dc", sibling], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  for await (const chunk of child.stdout) {
    hash.update(chunk);
    if (!isAllZero(chunk)) {
      writeSync(fd, chunk, 0, chunk.length, offset);
    }
    offset += chunk.length;
  }
  const status = await new Promise((resolve) => child.on("close", resolve));
  if (status !== 0) {
    throw new Error("zstd exited " + status + ": " + stderr.slice(0, 200));
  }
  ftruncateSync(fd, offset);
  closeSync(fd);
  console.log(hash.digest("hex"));
} catch (err) {
  try { closeSync(fd); } catch {}
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
}
`;
