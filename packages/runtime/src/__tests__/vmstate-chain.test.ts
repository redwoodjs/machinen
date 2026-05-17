import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SnapshotMeta } from "../vm-handle.ts";
import {
  materializeVmstateChain,
  readVmstate,
  VMSTATE_ARCH,
  VMSTATE_SECTION,
  writeVmstate,
} from "../vm/vmstate-chain.ts";

let TMP: string;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "vmstate-chain-"));
});

afterAll(() => {
  if (TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

const TOPO = Buffer.alloc(32, 0x42);

function writeMeta(dir: string, meta: SnapshotMeta): void {
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
}

function rootdiskDelta(offset: number, bytes: Buffer, diskSize: number): Buffer {
  const bodyHeader = Buffer.alloc(16);
  bodyHeader.writeBigUInt64LE(BigInt(offset), 0);
  bodyHeader.writeBigUInt64LE(BigInt(bytes.length), 8);
  const body = Buffer.concat([bodyHeader, bytes]);
  const header = Buffer.alloc(56);
  header.writeBigUInt64LE(BigInt(diskSize), 0);
  header.writeUInt32LE(4096, 8);
  createHash("sha256").update(body).digest().copy(header, 16);
  return Buffer.concat([header, body]);
}

describe("vmstate checkpoint chain materialization", () => {
  it("combines RAM sections and applies rootdisk deltas into a flat restore bundle", () => {
    const base = join(TMP, "base");
    const child = join(TMP, "child");
    rmSync(base, { recursive: true, force: true });
    rmSync(child, { recursive: true, force: true });
    mkdirSync(base, { recursive: true });
    mkdirSync(child, { recursive: true });

    writeVmstate(join(base, "state.vmstate"), {
      topologyHash: TOPO,
      sections: [
        { tag: VMSTATE_SECTION.ram, id: 0, payload: Buffer.from("base-ram") },
        { tag: VMSTATE_SECTION.vcpu, id: 0, payload: Buffer.from("base-vcpu") },
      ],
    });
    const baseDisk = Buffer.concat([Buffer.alloc(4096, 0x11), Buffer.alloc(4096, 0x22)]);
    writeFileSync(join(base, "rootdisk.img"), baseDisk);
    const baseMeta: SnapshotMeta = {
      engine: "vmstate",
      sourceImage: join(TMP, "rootfs.tar.gz"),
      snappedAt: 1,
      vmstate: {
        rootDisk: {
          mode: "block",
          file: "rootdisk.img",
          sizeBytes: baseDisk.length,
          sha256: "base",
        },
        checkpoint: { chainId: "chain", sequence: 1, ram: "full", rootDisk: "full" },
      },
    };
    writeMeta(base, baseMeta);

    const newBlock = Buffer.alloc(4096, 0x33);
    writeVmstate(join(child, "state.vmstate"), {
      topologyHash: TOPO,
      sections: [
        { tag: VMSTATE_SECTION.ramDelta, id: 0, payload: Buffer.from("child-ram-delta") },
        { tag: VMSTATE_SECTION.vcpu, id: 0, payload: Buffer.from("child-vcpu") },
        {
          tag: VMSTATE_SECTION.rootdiskDelta,
          id: 0,
          payload: rootdiskDelta(4096, newBlock, baseDisk.length),
        },
      ],
    });
    const childMeta: SnapshotMeta = {
      ...baseMeta,
      snappedAt: 2,
      vmstate: {
        ...baseMeta.vmstate,
        rootDisk: { mode: "delta" },
        checkpoint: {
          chainId: "chain",
          sequence: 2,
          parent: "../base",
          ram: "delta",
          rootDisk: "delta",
        },
      },
    };
    writeMeta(child, childMeta);

    const materialized = materializeVmstateChain(child, childMeta);
    try {
      const flat = readVmstate(materialized.statePath);
      expect(flat.sections.map((s) => s.tag)).toEqual([
        VMSTATE_SECTION.ram,
        VMSTATE_SECTION.ramDelta,
        VMSTATE_SECTION.vcpu,
      ]);
      expect(flat.sections[2]!.payload.toString()).toBe("child-vcpu");
      expect(readFileSync(join(materialized.snapDir, "rootdisk.img"))).toEqual(
        Buffer.concat([Buffer.alloc(4096, 0x11), newBlock]),
      );
      expect(materialized.meta.vmstate?.rootDisk?.mode).toBe("block");
    } finally {
      rmSync(materialized.tempDir, { recursive: true, force: true });
    }
  });

  it("preserves x86_64 arch and x86 device sections when flattening RAM deltas", () => {
    const base = join(TMP, "x86-base");
    const child = join(TMP, "x86-child");
    rmSync(base, { recursive: true, force: true });
    rmSync(child, { recursive: true, force: true });
    mkdirSync(base, { recursive: true });
    mkdirSync(child, { recursive: true });

    writeVmstate(join(base, "state.vmstate"), {
      arch: VMSTATE_ARCH.x86_64,
      topologyHash: TOPO,
      sections: [{ tag: VMSTATE_SECTION.ram, id: 0, payload: Buffer.from("base-ram") }],
    });
    const baseMeta: SnapshotMeta = {
      engine: "vmstate",
      sourceImage: join(TMP, "rootfs.tar.gz"),
      snappedAt: 1,
      vmstate: {
        rootDisk: { mode: "none" },
        checkpoint: { chainId: "x86-chain", sequence: 1, ram: "full", rootDisk: "none" },
      },
    };
    writeMeta(base, baseMeta);

    writeVmstate(join(child, "state.vmstate"), {
      arch: VMSTATE_ARCH.x86_64,
      topologyHash: TOPO,
      sections: [
        { tag: VMSTATE_SECTION.ramDelta, id: 0, payload: Buffer.from("child-ram-delta") },
        { tag: VMSTATE_SECTION.vcpu, id: 0, payload: Buffer.from("child-vcpu") },
        { tag: VMSTATE_SECTION.x86Irqchip, id: 2, payload: Buffer.from("ioapic") },
        { tag: VMSTATE_SECTION.x86Pit, id: 0, payload: Buffer.from("pit") },
      ],
    });
    const childMeta: SnapshotMeta = {
      ...baseMeta,
      snappedAt: 2,
      vmstate: {
        ...baseMeta.vmstate,
        checkpoint: {
          chainId: "x86-chain",
          sequence: 2,
          parent: "../x86-base",
          ram: "delta",
          rootDisk: "none",
        },
      },
    };
    writeMeta(child, childMeta);

    const materialized = materializeVmstateChain(child, childMeta);
    try {
      const flat = readVmstate(materialized.statePath);
      expect(flat.arch).toBe(VMSTATE_ARCH.x86_64);
      expect(flat.sections.map((s) => s.tag)).toEqual([
        VMSTATE_SECTION.ram,
        VMSTATE_SECTION.ramDelta,
        VMSTATE_SECTION.vcpu,
        VMSTATE_SECTION.x86Irqchip,
        VMSTATE_SECTION.x86Pit,
      ]);
      expect(materialized.meta.vmstate?.rootDisk?.mode).toBe("none");
    } finally {
      rmSync(materialized.tempDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed rootdisk deltas and cleans materialization temp dirs", () => {
    const before = new Set(
      readdirSync(tmpdir()).filter((name) =>
        name.startsWith(`machinen-vmstate-chain-${process.pid}-`),
      ),
    );
    const base = join(TMP, "bad-base");
    const child = join(TMP, "bad-child");
    rmSync(base, { recursive: true, force: true });
    rmSync(child, { recursive: true, force: true });
    mkdirSync(base, { recursive: true });
    mkdirSync(child, { recursive: true });

    writeVmstate(join(base, "state.vmstate"), {
      topologyHash: TOPO,
      sections: [{ tag: VMSTATE_SECTION.ram, id: 0, payload: Buffer.from("base-ram") }],
    });
    const baseDisk = Buffer.alloc(4096, 0x11);
    writeFileSync(join(base, "rootdisk.img"), baseDisk);
    const baseMeta: SnapshotMeta = {
      engine: "vmstate",
      sourceImage: join(TMP, "rootfs.tar.gz"),
      snappedAt: 1,
      vmstate: {
        rootDisk: {
          mode: "block",
          file: "rootdisk.img",
          sizeBytes: baseDisk.length,
          sha256: "base",
        },
        checkpoint: { chainId: "bad-chain", sequence: 1, ram: "full", rootDisk: "full" },
      },
    };
    writeMeta(base, baseMeta);

    writeVmstate(join(child, "state.vmstate"), {
      topologyHash: TOPO,
      sections: [
        { tag: VMSTATE_SECTION.ramDelta, id: 0, payload: Buffer.alloc(64) },
        {
          tag: VMSTATE_SECTION.rootdiskDelta,
          id: 0,
          payload: rootdiskDelta(4096, Buffer.alloc(4096, 0x22), baseDisk.length),
        },
      ],
    });
    const childMeta: SnapshotMeta = {
      ...baseMeta,
      snappedAt: 2,
      vmstate: {
        ...baseMeta.vmstate,
        rootDisk: { mode: "delta" },
        checkpoint: {
          chainId: "bad-chain",
          sequence: 2,
          parent: "../bad-base",
          ram: "delta",
          rootDisk: "delta",
        },
      },
    };
    writeMeta(child, childMeta);

    expect(() => materializeVmstateChain(child, childMeta)).toThrow(
      /invalid rootdisk delta extent/,
    );
    const after = readdirSync(tmpdir()).filter(
      (name) => name.startsWith(`machinen-vmstate-chain-${process.pid}-`) && !before.has(name),
    );
    expect(after).toEqual([]);
  });
});
