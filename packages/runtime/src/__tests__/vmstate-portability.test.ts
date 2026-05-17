import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restore } from "../index.ts";
import { currentVmstateBackend, readVmstateFacts } from "../vm/vmstate-metadata.ts";

const MAGIC = Buffer.from("VMSTATE\0");
const VERSION = 1;
const ARCH_AARCH64 = 1;
const SECTION_TAG = { vcpu: 2 };
const TOPO = Buffer.alloc(32, 0xa5);

let TMP: string;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "vmstate-portability-"));
});

afterAll(() => {
  if (TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

function encodeVmstate(sctlrEl1: bigint): Buffer {
  const vcpu = encodeVcpuPayload([{ name: "SCTLR_EL1", value: u64(sctlrEl1) }]);
  const header = Buffer.alloc(64);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(VERSION, 8);
  header.writeUInt32LE(ARCH_AARCH64, 12);
  header.writeUInt32LE(1, 16);
  TOPO.copy(header, 24);

  const section = Buffer.alloc(16);
  section.writeUInt32LE(SECTION_TAG.vcpu, 0);
  section.writeBigUInt64LE(BigInt(vcpu.length), 8);
  return Buffer.concat([header, section, vcpu]);
}

function encodeVcpuPayload(entries: { name: string; value: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(4)];
  parts[0].writeUInt32LE(entries.length, 0);
  for (const e of entries) {
    const name = Buffer.from(e.name, "ascii");
    const valueLen = Buffer.alloc(4);
    valueLen.writeUInt32LE(e.value.length, 0);
    parts.push(Buffer.from([name.length]), name, valueLen, e.value);
  }
  return Buffer.concat(parts);
}

function u64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

function writeBundle(name: string, meta: unknown, sctlr: bigint): { dir: string; image: string } {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(TMP, `${name}.tar.gz`), "not a real tarball");
  const image = join(TMP, `${name}.tar.gz`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.vmstate"), encodeVmstate(sctlr));
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  return { dir, image };
}

describe("vmstate portability metadata", () => {
  it("detects guest PAuth from SCTLR_EL1", () => {
    const inactive = join(TMP, "nopauth.vmstate");
    const active = join(TMP, "pauth.vmstate");
    writeFileSync(inactive, encodeVmstate(0n));
    writeFileSync(active, encodeVmstate(1n << 31n));

    expect(readVmstateFacts(inactive)).toMatchObject({
      arch: "arm64",
      topologyHash: TOPO.toString("hex"),
      guestPauthActive: false,
    });
    expect(readVmstateFacts(active)).toMatchObject({ guestPauthActive: true });
  });

  it("refuses vmstate bundles that predate restore invariants", async () => {
    const { dir, image } = writeBundle("old", { engine: "vmstate", snappedAt: 1 }, 0n);
    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /predates restore invariants/,
    );
  });

  it("refuses cross-guest-architecture vmstate restore", async () => {
    const original = process.env.MACHINEN_GUEST_ARCH;
    process.env.MACHINEN_GUEST_ARCH = "amd64";
    try {
      const target = currentVmstateBackend();
      const { dir, image } = writeBundle(
        "bad-guest-arch",
        {
          engine: "vmstate",
          snappedAt: 1,
          vmstate: {
            sourceBackend: target,
            guestArch: "arm64",
            topologyHash: TOPO.toString("hex"),
            guestPauth: { active: false, sctlrEl1: "0x0" },
            rootDisk: { mode: "none" },
          },
        },
        0n,
      );

      await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
        /guest architecture mismatch/,
      );
    } finally {
      if (original === undefined) {
        delete process.env.MACHINEN_GUEST_ARCH;
      } else {
        process.env.MACHINEN_GUEST_ARCH = original;
      }
    }
  });

  it("refuses cross-VMM restore when guest PAuth is active", async () => {
    const target = currentVmstateBackend();
    if (target === "unknown") {
      return;
    }
    const source = target === "hvf" ? "kvm" : "hvf";
    const { dir, image } = writeBundle(
      "pauth-cross",
      {
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: source,
          topologyHash: TOPO.toString("hex"),
          guestPauth: { active: true, sctlrEl1: "0x80000000" },
          rootDisk: { mode: "none" },
        },
      },
      1n << 31n,
    );

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /unsupported cross-VMM vmstate restore/,
    );
  });

  it("refuses a vmstate bundle whose recorded topology does not match the vmstate file", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "bad-topology",
      {
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: Buffer.alloc(32, 0x5a).toString("hex"),
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: { mode: "none" },
        },
      },
      0n,
    );

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /topology metadata does not match/,
    );
  });

  it("refuses a vmstate restore with a different requested guest RAM ceiling", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "bad-memory",
      {
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: TOPO.toString("hex"),
          memoryCeilingMib: 2048,
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: { mode: "none" },
        },
      },
      0n,
    );

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh", memory: 1024 })).rejects.toThrow(
      /guest RAM layout mismatch/,
    );
  });

  it("refuses a vmstate bundle whose recorded rootdisk file is missing", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "missing-rootdisk",
      {
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: TOPO.toString("hex"),
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: {
            mode: "block",
            file: "rootdisk.img",
            sizeBytes: 0,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        },
      },
      0n,
    );

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /missing rootdisk image/,
    );
  });

  it("refuses a vmstate bundle whose rootdisk bytes differ from metadata", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "bad-rootdisk",
      {
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: TOPO.toString("hex"),
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: {
            mode: "block",
            file: "rootdisk.img",
            sizeBytes: 0,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        },
      },
      0n,
    );
    writeFileSync(join(dir, "rootdisk.img"), "changed");

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /rootdisk identity mismatch/,
    );
  });
});
