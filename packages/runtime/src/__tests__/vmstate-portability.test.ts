import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restore } from "../index.ts";
import {
  currentVmstateBackend,
  fileIdentity,
  fileSampleSha256,
  managedRootDiskSyntheticSha256,
  readVmstateFacts,
  rememberTrustedFileIdentity,
  trustedFileIdentity,
} from "../vm/vmstate-metadata.ts";

const MAGIC = Buffer.from("VMSTATE\0");
const VERSION = 1;
const ARCH_AARCH64 = 1;
const SECTION_TAG = { vcpu: 2 };
const TOPO = Buffer.alloc(32, 0xa5);

let TMP: string;
let helperTmp: string | undefined;
let originalGuestArch: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "vmstate-portability-"));
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
  originalGuestArch = process.env.MACHINEN_GUEST_ARCH;
  process.env.MACHINEN_GUEST_ARCH = "arm64";
});

afterAll(() => {
  if (originalGuestArch === undefined) {
    delete process.env.MACHINEN_GUEST_ARCH;
  } else {
    process.env.MACHINEN_GUEST_ARCH = originalGuestArch;
  }
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
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

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
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

  it("uses native restore image planning for missing explicit and metadata images", async () => {
    const { dir } = writeBundle("missing-explicit-image", { engine: "vmstate", snappedAt: 1 }, 0n);
    const explicit = join(TMP, "missing-explicit.tar.gz");
    await expect(restore({ snapDir: dir, image: explicit, binary: "/bin/sh" })).rejects.toThrow(
      `restore: image not found: ${explicit}`,
    );

    const metaSource = join(TMP, "missing-meta-source.tar.gz");
    const { dir: metaDir } = writeBundle(
      "missing-meta-image",
      { engine: "vmstate", snappedAt: 1, sourceImage: metaSource },
      0n,
    );
    await expect(restore({ snapDir: metaDir, binary: "/bin/sh" })).rejects.toThrow(
      `restore: source image not found at ${metaSource}`,
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

      let error: unknown;
      try {
        await restore({ snapDir: dir, image, binary: "/bin/sh" });
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: "BOOT_VMSTATE_CROSS_ISA_UNSUPPORTED",
        message: expect.stringContaining("cross-isa-vmstate-restore-unsupported"),
      });
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /snapshot guest: arm64[\s\S]*restore guest:\s+amd64[\s\S]*target-isa-vm-process-restore/,
        ),
      });
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

  it("reuses trusted file identity only while the file stamp is unchanged", () => {
    const path = join(TMP, "trusted-rootdisk.img");
    writeFileSync(path, "same-size-a");
    const identity = fileIdentity(path);
    rememberTrustedFileIdentity(identity);

    expect(trustedFileIdentity(path)).toMatchObject(identity);

    writeFileSync(path, "same-size-b");

    expect(trustedFileIdentity(path)).toBeUndefined();
  });

  it("refuses an explicit caller-managed rootDisk whose bytes differ from metadata", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "bad-explicit-rootdisk",
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
            sizeBytes: 4,
            sha256: sha256("good"),
          },
        },
      },
      0n,
    );
    const explicitRootDisk = join(TMP, "explicit-rootdisk.img");
    writeFileSync(join(dir, "rootdisk.img"), "good");
    writeFileSync(explicitRootDisk, "evil");

    await expect(
      restore({ snapDir: dir, image, binary: "/bin/sh", rootDisk: explicitRootDisk }),
    ).rejects.toThrow(/rootdisk identity mismatch/);
  });

  it("still refuses explicit caller-managed rootDisk for managed bundled samples", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "sample-explicit-rootdisk",
      { engine: "vmstate", snappedAt: 1, vmstate: { sourceBackend: target } },
      0n,
    );
    const bundled = join(dir, "rootdisk.img");
    writeFileSync(bundled, "good");
    const sampleSha256 = fileSampleSha256(bundled);
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: TOPO.toString("hex"),
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: {
            mode: "block",
            file: "rootdisk.img",
            sizeBytes: 4,
            sha256: managedRootDiskSyntheticSha256(4, sampleSha256),
            trustedContentSample: {
              algorithm: "machinen-rootdisk-sample-v1",
              sha256: sampleSha256,
            },
          },
        },
      }),
    );
    const explicitRootDisk = join(TMP, "sample-explicit-rootdisk.img");
    writeFileSync(explicitRootDisk, "good");

    await expect(
      restore({ snapDir: dir, image, binary: "/bin/sh", rootDisk: explicitRootDisk }),
    ).rejects.toThrow(/rootdisk identity mismatch/);
  });

  it("refuses a managed-sample vmstate bundle whose rootdisk sample differs", async () => {
    const target = currentVmstateBackend();
    const { dir, image } = writeBundle(
      "bad-sample-rootdisk",
      { engine: "vmstate", snappedAt: 1, vmstate: { sourceBackend: target } },
      0n,
    );
    const expectedSample = sha256("not-the-file-sample");
    writeFileSync(join(dir, "rootdisk.img"), "changed");
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({
        engine: "vmstate",
        snappedAt: 1,
        vmstate: {
          sourceBackend: target,
          topologyHash: TOPO.toString("hex"),
          guestPauth: { active: false, sctlrEl1: "0x0" },
          rootDisk: {
            mode: "block",
            file: "rootdisk.img",
            sizeBytes: 7,
            sha256: managedRootDiskSyntheticSha256(7, expectedSample),
            trustedContentSample: {
              algorithm: "machinen-rootdisk-sample-v1",
              sha256: expectedSample,
            },
          },
        },
      }),
    );

    await expect(restore({ snapDir: dir, image, binary: "/bin/sh" })).rejects.toThrow(
      /rootdisk identity mismatch/,
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
