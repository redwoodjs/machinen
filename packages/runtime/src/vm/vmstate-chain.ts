import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { BootError } from "../errors.ts";
import type { SnapshotMeta, VmstateSnapshotMeta } from "../vm-handle.ts";
import { reflinkCopy } from "../reflink.ts";
import { VMSTATE_FILE, VMSTATE_ROOTDISK_FILE } from "./snapshot-engine.ts";
import { fileIdentity } from "./vmstate-metadata.ts";

export const VMSTATE_SECTION = {
  ram: 1,
  vcpu: 2,
  gicDist: 3,
  gicRedist: 4,
  virtio: 5,
  gicCpuif: 6,
  virtiofsState: 7,
  ramDelta: 8,
  rootdiskDelta: 9,
  x86Irqchip: 10,
  x86Pit: 11,
} as const;

export const VMSTATE_ARCH = {
  aarch64: 1,
  x86_64: 2,
} as const;

const MAGIC = Buffer.from("VMSTATE\0");
const HEADER_SIZE = 64;
const SECTION_HEADER_SIZE = 16;
const ROOTDISK_DELTA_HEADER_SIZE = 56;
const ROOTDISK_DELTA_BLOCK_SIZE = 4096;

interface VmstateSection {
  tag: number;
  id: number;
  payload: Buffer;
}

interface DecodedVmstate {
  arch?: number;
  topologyHash: Buffer;
  sections: VmstateSection[];
}

interface MaterializedVmstateChain {
  tempDir: string;
  snapDir: string;
  statePath: string;
  meta: SnapshotMeta;
}

export function readVmstate(path: string): DecodedVmstate {
  const raw = readFileSync(path);
  const bytes = maybeGunzip(raw);
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`vmstate: truncated header (${bytes.length} bytes)`);
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("vmstate: bad magic");
  }
  const version = bytes.readUInt32LE(8);
  if (version !== 1) {
    throw new Error(`vmstate: unsupported version ${version}`);
  }
  const arch = bytes.readUInt32LE(12);
  if (arch !== VMSTATE_ARCH.aarch64 && arch !== VMSTATE_ARCH.x86_64) {
    throw new Error(`vmstate: unsupported arch ${arch}`);
  }
  const sectionCount = bytes.readUInt32LE(16);
  const topologyHash = Buffer.from(bytes.subarray(24, 56));
  const sections: VmstateSection[] = [];
  let off = HEADER_SIZE;
  for (let i = 0; i < sectionCount; i++) {
    if (off + SECTION_HEADER_SIZE > bytes.length) {
      throw new Error("vmstate: truncated section header");
    }
    const tag = bytes.readUInt32LE(off);
    const id = bytes.readUInt32LE(off + 4);
    const len = Number(bytes.readBigUInt64LE(off + 8));
    off += SECTION_HEADER_SIZE;
    if (!Number.isSafeInteger(len) || len < 0 || off + len > bytes.length) {
      throw new Error("vmstate: section overflows file");
    }
    sections.push({ tag, id, payload: Buffer.from(bytes.subarray(off, off + len)) });
    off += len;
  }
  return { arch, topologyHash, sections };
}

export function writeVmstate(path: string, vmstate: DecodedVmstate): void {
  let total = HEADER_SIZE;
  for (const s of vmstate.sections) {
    total += SECTION_HEADER_SIZE + s.payload.length;
  }
  const out = Buffer.alloc(total);
  MAGIC.copy(out, 0);
  out.writeUInt32LE(1, 8);
  out.writeUInt32LE(vmstate.arch ?? VMSTATE_ARCH.aarch64, 12);
  out.writeUInt32LE(vmstate.sections.length, 16);
  vmstate.topologyHash.copy(out, 24);
  let off = HEADER_SIZE;
  for (const s of vmstate.sections) {
    out.writeUInt32LE(s.tag, off);
    out.writeUInt32LE(s.id, off + 4);
    out.writeBigUInt64LE(BigInt(s.payload.length), off + 8);
    off += SECTION_HEADER_SIZE;
    s.payload.copy(out, off);
    off += s.payload.length;
  }
  writeFileSync(path, out);
}

export function vmstateSectionTags(path: string): number[] {
  return readVmstate(path).sections.map((s) => s.tag);
}

export function relativeCheckpointParent(
  snapDir: string,
  parentDir: string | undefined,
): string | undefined {
  if (!parentDir) {
    return undefined;
  }
  const rel = relative(snapDir, parentDir);
  return rel === "" ? "." : rel;
}

function resolveCheckpointParent(snapDir: string, parent: string): string {
  return isAbsolute(parent) ? parent : resolve(snapDir, parent);
}

export function materializeVmstateChain(
  targetDir: string,
  targetMeta: SnapshotMeta,
): MaterializedVmstateChain {
  const chain = readCheckpointChain(targetDir, targetMeta);
  if (chain.length === 1 && !stateHasDeltaSections(join(targetDir, VMSTATE_FILE))) {
    throw new Error("materializeVmstateChain called for a non-incremental vmstate bundle");
  }

  const tempDir = join(
    tmpdir(),
    `machinen-vmstate-chain-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  mkdirSync(tempDir, { recursive: true });

  try {
    const statePath = join(tempDir, VMSTATE_FILE);
    const combined = combineVmstateRam(chain);
    writeVmstate(statePath, combined);

    const targetRootMode = targetMeta.vmstate?.rootDisk?.mode;
    const meta: SnapshotMeta = {
      ...targetMeta,
      vmstate: {
        ...targetMeta.vmstate,
        rootDisk:
          targetRootMode === "none" ? { mode: "none" } : materializeRootdisk(chain, tempDir),
      },
    };

    return { tempDir, snapDir: tempDir, statePath, meta };
  } catch (err) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }
}

function readCheckpointChain(
  targetDir: string,
  targetMeta: SnapshotMeta,
): Array<{ dir: string; meta: SnapshotMeta; state: DecodedVmstate }> {
  const out: Array<{ dir: string; meta: SnapshotMeta; state: DecodedVmstate }> = [];
  const seen = new Set<string>();
  let dir = targetDir;
  let meta = targetMeta;
  while (true) {
    const real = resolve(dir);
    if (seen.has(real)) {
      throw new BootError(
        "BOOT_VMSTATE_UNSUPPORTED",
        `restore: vmstate checkpoint parent cycle at ${real}`,
      );
    }
    seen.add(real);
    const statePath = join(real, VMSTATE_FILE);
    if (!existsSync(statePath)) {
      throw new BootError(
        "BOOT_SNAPSHOT_NOT_FOUND",
        `restore: vmstate checkpoint state missing: ${statePath}`,
      );
    }
    out.push({ dir: real, meta, state: readVmstate(statePath) });
    const parent = meta.vmstate?.checkpoint?.parent;
    if (!parent) {
      break;
    }
    dir = resolveCheckpointParent(real, parent);
    meta = readMeta(dir);
  }
  out.reverse();
  return out;
}

function readMeta(dir: string): SnapshotMeta {
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: checkpoint parent meta missing: ${metaPath}`,
    );
  }
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
  } catch (err) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: failed to read checkpoint parent meta: ${metaPath}`,
      { cause: err },
    );
  }
}

function stateHasDeltaSections(statePath: string): boolean {
  const tags = vmstateSectionTags(statePath);
  return tags.includes(VMSTATE_SECTION.ramDelta) || tags.includes(VMSTATE_SECTION.rootdiskDelta);
}

function combineVmstateRam(
  chain: Array<{ dir: string; meta: SnapshotMeta; state: DecodedVmstate }>,
): DecodedVmstate {
  const target = chain[chain.length - 1]!;
  const ramBaseIndex = findLatestRamBaseIndex(chain);
  if (ramBaseIndex < 0) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate checkpoint chain has no full RAM base",
    );
  }
  const ramSections: VmstateSection[] = [];
  const baseRam = chain[ramBaseIndex]!.state.sections.find((s) => s.tag === VMSTATE_SECTION.ram);
  if (!baseRam) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate checkpoint chain has no full RAM base",
    );
  }
  ramSections.push(baseRam);
  for (const item of chain.slice(ramBaseIndex + 1)) {
    ramSections.push(...item.state.sections.filter((s) => s.tag === VMSTATE_SECTION.ramDelta));
  }

  const targetNonRam = target.state.sections.filter(
    (s) =>
      s.tag !== VMSTATE_SECTION.ram &&
      s.tag !== VMSTATE_SECTION.ramDelta &&
      s.tag !== VMSTATE_SECTION.rootdiskDelta,
  );
  return {
    arch: target.state.arch,
    topologyHash: target.state.topologyHash,
    sections: [...ramSections, ...targetNonRam],
  };
}

function findLatestRamBaseIndex(chain: Array<{ state: DecodedVmstate }>): number {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i]!.state.sections.some((s) => s.tag === VMSTATE_SECTION.ram)) {
      return i;
    }
  }
  return -1;
}

function materializeRootdisk(
  chain: Array<{ dir: string; meta: SnapshotMeta; state: DecodedVmstate }>,
  tempDir: string,
): VmstateSnapshotMeta["rootDisk"] {
  const baseIndex = findLatestRootdiskBaseIndex(chain);
  if (baseIndex < 0) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate checkpoint chain has no full rootdisk base",
    );
  }

  const dest = join(tempDir, VMSTATE_ROOTDISK_FILE);
  const base = chain[baseIndex]!;
  const root = base.meta.vmstate?.rootDisk;
  if (!root || root.mode !== "block") {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: invalid vmstate rootdisk base metadata",
    );
  }
  const basePath = join(base.dir, root.file);
  if (!existsSync(basePath)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: vmstate rootdisk base missing: ${basePath}`,
    );
  }
  reflinkCopy(basePath, dest);

  const fd = openSync(dest, "r+");
  try {
    for (const item of chain.slice(baseIndex + 1)) {
      for (const section of item.state.sections) {
        if (section.tag === VMSTATE_SECTION.rootdiskDelta) {
          applyRootdiskDelta(fd, dest, section.payload);
        }
      }
    }
  } finally {
    closeSync(fd);
  }

  const identity = fileIdentity(dest);
  return {
    mode: "block",
    file: VMSTATE_ROOTDISK_FILE,
    path: dest,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
  };
}

function findLatestRootdiskBaseIndex(chain: Array<{ meta: SnapshotMeta }>): number {
  for (let i = chain.length - 1; i >= 0; i--) {
    const root = chain[i]!.meta.vmstate?.rootDisk;
    if (root?.mode === "block") {
      return i;
    }
  }
  return -1;
}

interface RootdiskDeltaPayload {
  diskSize: number;
  body: Buffer;
}

interface RootdiskDeltaExtent {
  extentOff: number;
  len: number;
  dataOff: number;
}

function applyRootdiskDelta(fd: number, destPath: string, payload: Buffer): void {
  const delta = parseRootdiskDeltaPayload(destPath, payload);
  applyRootdiskDeltaExtents(fd, delta);
}

function parseRootdiskDeltaPayload(destPath: string, payload: Buffer): RootdiskDeltaPayload {
  assertRootdiskDeltaHeader(payload);
  const diskSize = readRootdiskDeltaDiskSize(payload);
  assertRootdiskDeltaBlockSize(payload.readUInt32LE(8));
  assertRootdiskDeltaSizeMatches(destPath, diskSize);
  const body = payload.subarray(ROOTDISK_DELTA_HEADER_SIZE);
  assertRootdiskDeltaHash(payload, body);
  return { diskSize, body };
}

function assertRootdiskDeltaHeader(payload: Buffer): void {
  if (payload.length < ROOTDISK_DELTA_HEADER_SIZE) {
    throw new BootError("BOOT_VMSTATE_UNSUPPORTED", "restore: truncated rootdisk delta header");
  }
}

function readRootdiskDeltaDiskSize(payload: Buffer): number {
  const diskSize = Number(payload.readBigUInt64LE(0));
  if (!Number.isSafeInteger(diskSize) || diskSize < 0) {
    throw new BootError("BOOT_VMSTATE_UNSUPPORTED", "restore: invalid rootdisk delta size");
  }
  return diskSize;
}

function assertRootdiskDeltaBlockSize(blockSize: number): void {
  if (blockSize !== ROOTDISK_DELTA_BLOCK_SIZE) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      `restore: unsupported rootdisk delta block size ${blockSize}`,
    );
  }
}

function assertRootdiskDeltaSizeMatches(destPath: string, diskSize: number): void {
  const actualSize = statSync(destPath).size;
  if (actualSize !== diskSize) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      `restore: rootdisk delta size mismatch (base=${actualSize}, delta=${diskSize})`,
    );
  }
}

function assertRootdiskDeltaHash(payload: Buffer, body: Buffer): void {
  const expected = payload.subarray(16, 48).toString("hex");
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    throw new BootError("BOOT_VMSTATE_UNSUPPORTED", "restore: rootdisk delta hash mismatch");
  }
}

function applyRootdiskDeltaExtents(fd: number, delta: RootdiskDeltaPayload): void {
  let off = 0;
  while (off < delta.body.length) {
    const extent = readRootdiskDeltaExtent(delta, off);
    writeAllAt(
      fd,
      delta.body.subarray(extent.dataOff, extent.dataOff + extent.len),
      extent.extentOff,
    );
    off = extent.dataOff + extent.len;
  }
}

function readRootdiskDeltaExtent(delta: RootdiskDeltaPayload, off: number): RootdiskDeltaExtent {
  assertRootdiskDeltaExtentHeader(delta.body, off);
  const extentOff = Number(delta.body.readBigUInt64LE(off));
  const len = Number(delta.body.readBigUInt64LE(off + 8));
  const dataOff = off + 16;
  assertRootdiskDeltaExtentValid(delta, { extentOff, len, dataOff });
  return { extentOff, len, dataOff };
}

function assertRootdiskDeltaExtentHeader(body: Buffer, off: number): void {
  if (body.length - off < 16) {
    throw new BootError("BOOT_VMSTATE_UNSUPPORTED", "restore: truncated rootdisk delta extent");
  }
}

function assertRootdiskDeltaExtentValid(
  delta: RootdiskDeltaPayload,
  extent: RootdiskDeltaExtent,
): void {
  if (!rootdiskDeltaExtentIsValid(delta, extent)) {
    throw new BootError("BOOT_VMSTATE_UNSUPPORTED", "restore: invalid rootdisk delta extent");
  }
}

function rootdiskDeltaExtentIsValid(
  delta: RootdiskDeltaPayload,
  extent: RootdiskDeltaExtent,
): boolean {
  return (
    Number.isSafeInteger(extent.extentOff) &&
    Number.isSafeInteger(extent.len) &&
    extent.extentOff >= 0 &&
    extent.len >= 0 &&
    extent.len <= delta.diskSize - extent.extentOff &&
    extent.len <= delta.body.length - extent.dataOff
  );
}

function writeAllAt(fd: number, bytes: Buffer, position: number): void {
  let off = 0;
  while (off < bytes.length) {
    const n = writeSync(fd, bytes, off, bytes.length - off, position + off);
    if (n <= 0) {
      throw new Error("short write applying rootdisk delta");
    }
    off += n;
  }
}

function maybeGunzip(raw: Buffer): Buffer {
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    return gunzipSync(raw);
  }
  return raw;
}
