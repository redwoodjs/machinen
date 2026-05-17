import { createHash } from "node:crypto";
import { openSync, readFileSync, readSync, statSync, closeSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { SnapshotFileIdentity as FileIdentity, VmstateBackend } from "../vm-handle.ts";

export type { VmstateBackend } from "../vm-handle.ts";
export type VmstateGuestArch = "arm64" | "amd64" | "unknown";

export interface VmstateFacts {
  arch: VmstateGuestArch;
  topologyHash: string;
  sectionCount: number;
  guestPauthActive?: boolean;
  sctlrEl1?: string;
}

const VMSTATE_MAGIC = Buffer.from([0x56, 0x4d, 0x53, 0x54, 0x41, 0x54, 0x45, 0x00]);
const VMSTATE_HEADER_SIZE = 64;
const SECTION_TAG_VCPU = 2;
const VMSTATE_ARCH_AARCH64 = 1;
const VMSTATE_ARCH_X86_64 = 2;

// SCTLR_EL1 pointer-auth enable bits. If any is set, the guest may
// have signed code/data pointers in RAM and a cross-VMM restore is not
// safe unless both sides implement a proven compatible PAuth story.
const SCTLR_ENIA = 1n << 31n;
const SCTLR_ENIB = 1n << 30n;
const SCTLR_ENDA = 1n << 27n;
const SCTLR_ENDB = 1n << 13n;
const SCTLR_PAUTH_MASK = SCTLR_ENIA | SCTLR_ENIB | SCTLR_ENDA | SCTLR_ENDB;

function vmstateArchName(arch: number): VmstateGuestArch {
  if (arch === VMSTATE_ARCH_AARCH64) {
    return "arm64";
  }
  if (arch === VMSTATE_ARCH_X86_64) {
    return "amd64";
  }
  return "unknown";
}

export function currentVmstateBackend(): VmstateBackend {
  if (process.platform === "darwin") {
    return "hvf";
  }
  if (process.platform === "linux") {
    return "kvm";
  }
  return "unknown";
}

export function currentVmstateGuestArch(): VmstateGuestArch {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "arm64" || override === "aarch64") {
    return "arm64";
  }
  if (override === "amd64" || override === "x86_64" || override === "x64") {
    return "amd64";
  }
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  return "unknown";
}

export function readVmstateFacts(path: string): VmstateFacts {
  const raw = readFileSync(path);
  const bytes = maybeGunzip(raw);
  if (bytes.length < VMSTATE_HEADER_SIZE) {
    throw new Error(`vmstate: truncated header (${bytes.length} bytes)`);
  }
  if (!bytes.subarray(0, VMSTATE_MAGIC.length).equals(VMSTATE_MAGIC)) {
    throw new Error("vmstate: bad magic");
  }
  const version = bytes.readUInt32LE(8);
  if (version !== 1) {
    throw new Error(`vmstate: unsupported version ${version}`);
  }
  const archId = bytes.readUInt32LE(12);
  const arch = vmstateArchName(archId);
  if (arch === "unknown") {
    throw new Error(`vmstate: unsupported arch ${archId}`);
  }

  const sectionCount = bytes.readUInt32LE(16);
  const topologyHash = bytes.subarray(24, 56).toString("hex");
  let off = VMSTATE_HEADER_SIZE;
  let sctlrEl1: string | undefined;
  let guestPauthActive: boolean | undefined;

  for (let i = 0; i < sectionCount; i++) {
    if (off + 16 > bytes.length) {
      throw new Error("vmstate: truncated section header");
    }
    const tag = bytes.readUInt32LE(off);
    const len = Number(bytes.readBigUInt64LE(off + 8));
    off += 16;
    if (!Number.isSafeInteger(len) || len < 0 || off + len > bytes.length) {
      throw new Error("vmstate: section overflows file");
    }
    const payload = bytes.subarray(off, off + len);
    off += len;

    if (tag === SECTION_TAG_VCPU) {
      const sctlr = readVcpuU64(payload, "SCTLR_EL1");
      if (sctlr !== undefined) {
        sctlrEl1 = `0x${sctlr.toString(16)}`;
        guestPauthActive = (sctlr & SCTLR_PAUTH_MASK) !== 0n;
      }
    }
  }

  return { arch, topologyHash, sectionCount, guestPauthActive, sctlrEl1 };
}

export function fileIdentity(path: string): FileIdentity {
  return {
    path,
    sizeBytes: statSync(path).size,
    sha256: sha256File(path),
  };
}

function sha256File(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const nread = readSync(fd, buf, 0, buf.length, null);
      if (nread <= 0) {
        break;
      }
      h.update(buf.subarray(0, nread));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

function maybeGunzip(raw: Buffer): Buffer {
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    return gunzipSync(raw);
  }
  return raw;
}

function readVcpuU64(payload: Buffer, needle: string): bigint | undefined {
  if (payload.length < 4) {
    throw new Error("vmstate: truncated vcpu payload");
  }
  const count = payload.readUInt32LE(0);
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (off + 1 > payload.length) {
      throw new Error("vmstate: truncated vcpu entry");
    }
    const nameLen = payload[off]!;
    off += 1;
    if (off + nameLen + 4 > payload.length) {
      throw new Error("vmstate: truncated vcpu name");
    }
    const name = payload.subarray(off, off + nameLen).toString("ascii");
    off += nameLen;
    const valueLen = payload.readUInt32LE(off);
    off += 4;
    if (off + valueLen > payload.length) {
      throw new Error("vmstate: truncated vcpu value");
    }
    if (name === needle) {
      if (valueLen !== 8) {
        throw new Error(`vmstate: ${needle} has ${valueLen} bytes, expected 8`);
      }
      return payload.readBigUInt64LE(off);
    }
    off += valueLen;
  }
  return undefined;
}
