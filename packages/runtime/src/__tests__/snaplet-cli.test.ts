// End-to-end test for the snapshot-test CLI (task #16). Encodes
// .snaplet fixtures in TS (the format is small enough to inline),
// shells out to the binary, asserts exit codes and messages.
//
// Skips when packages/microvm/zig-out/bin/snapshot-test isn't built
// — run `zig build` in packages/microvm first.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "../../../microvm/zig-out/bin/snapshot-test");
const HAS_BIN = existsSync(BIN);

const MAGIC = Buffer.from("SNAPLET\0");
const VERSION = 1;
const ARCH_AARCH64 = 1;
const SECTION_TAG = { ram: 1, vcpu: 2, gic_dist: 3, gic_redist: 4, virtio: 5 };

type Section = { tag: number; id: number; payload: Buffer };

function encodeHeader(topology: Buffer, sectionCount: number): Buffer {
  const h = Buffer.alloc(64);
  MAGIC.copy(h, 0);
  h.writeUInt32LE(VERSION, 8);
  h.writeUInt32LE(ARCH_AARCH64, 12);
  h.writeUInt32LE(sectionCount, 16);
  // reserved u32 at 20
  topology.copy(h, 24);
  // reserved2[8] at 56
  return h;
}

function encodeSnaplet(topology: Buffer, sections: Section[]): Buffer {
  const parts: Buffer[] = [encodeHeader(topology, sections.length)];
  for (const s of sections) {
    const hdr = Buffer.alloc(16);
    hdr.writeUInt32LE(s.tag, 0);
    hdr.writeUInt32LE(s.id, 4);
    hdr.writeBigUInt64LE(BigInt(s.payload.length), 8);
    parts.push(hdr, s.payload);
  }
  return Buffer.concat(parts);
}

function encodeVcpuPayload(entries: { name: string; value: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(4)];
  parts[0].writeUInt32LE(entries.length, 0);
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, "ascii");
    if (nameBytes.length > 255) {
      throw new Error(`name too long: ${e.name}`);
    }
    const nameLen = Buffer.from([nameBytes.length]);
    const valueLen = Buffer.alloc(4);
    valueLen.writeUInt32LE(e.value.length, 0);
    parts.push(nameLen, nameBytes, valueLen, e.value);
  }
  return Buffer.concat(parts);
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(BIN, args, { encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

let TMP: string;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "snaplet-test-"));
});
afterAll(() => {
  if (TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

function write(name: string, bytes: Buffer): string {
  const p = join(TMP, name);
  writeFileSync(p, bytes);
  return p;
}

const TOPO_A = Buffer.alloc(32, 0xaa);
const TOPO_B = Buffer.alloc(32, 0xbb);

describe.skipIf(!HAS_BIN)("snapshot-test CLI", () => {
  describe("usage", () => {
    it("--help exits 0 and prints usage", () => {
      const r = run(["--help"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toMatch(/Usage:/);
    });

    it("unknown subcommand exits 2", () => {
      const r = run(["nonsense"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/unknown subcommand/);
    });

    it("no args exits 2", () => {
      const r = run([]);
      expect(r.code).toBe(2);
    });
  });

  describe("dump and translate", () => {
    it("dump with no flags exits 2 with a usage message", () => {
      const r = run(["dump"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/--vmm=.*--section=/);
    });

    it("translate returns non-zero with a 'not yet wired' message", () => {
      const r = run(["translate"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/not yet wired/);
    });
  });

  describe("load", () => {
    it("accepts a valid empty-section .snaplet", () => {
      const p = write("empty.snaplet", encodeSnaplet(TOPO_A, []));
      const r = run(["load", p]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/load: ok \(0 sections\)/);
    });

    it("accepts a valid .snaplet with multiple sections", () => {
      const p = write(
        "multi.snaplet",
        encodeSnaplet(TOPO_A, [
          { tag: SECTION_TAG.ram, id: 0, payload: Buffer.from("ram-bytes") },
          { tag: SECTION_TAG.gic_dist, id: 0, payload: Buffer.from("gic-bytes") },
        ]),
      );
      const r = run(["load", p]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/load: ok \(2 sections\)/);
    });

    it("rejects bad magic", () => {
      const bytes = encodeSnaplet(TOPO_A, []);
      bytes[0] = "X".charCodeAt(0);
      const p = write("bad-magic.snaplet", bytes);
      const r = run(["load", p]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/BadMagic/);
    });

    it("rejects unsupported version", () => {
      const bytes = encodeSnaplet(TOPO_A, []);
      bytes.writeUInt32LE(99, 8); // version at offset 8
      const p = write("bad-version.snaplet", bytes);
      const r = run(["load", p]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/UnsupportedVersion/);
    });

    it("rejects unsupported arch", () => {
      const bytes = encodeSnaplet(TOPO_A, []);
      bytes.writeUInt32LE(2, 12); // arch at offset 12
      const p = write("bad-arch.snaplet", bytes);
      const r = run(["load", p]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/UnsupportedArch/);
    });

    it("rejects truncated buffer", () => {
      const p = write("trunc.snaplet", Buffer.from("short"));
      const r = run(["load", p]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/Truncated/);
    });

    it("rejects section overflow", () => {
      const full = encodeSnaplet(TOPO_A, [
        { tag: SECTION_TAG.ram, id: 0, payload: Buffer.alloc(100, 0x42) },
      ]);
      // Slice 50 bytes off the payload — section header still claims 100.
      const p = write("overflow.snaplet", full.subarray(0, full.length - 50));
      const r = run(["load", p]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/SectionOverflow/);
    });

    it("accepts matching --expected-topology", () => {
      const p = write("topo-match.snaplet", encodeSnaplet(TOPO_A, []));
      const r = run(["load", p, `--expected-topology=${TOPO_A.toString("hex")}`]);
      expect(r.code).toBe(0);
    });

    it("rejects mismatched --expected-topology", () => {
      const p = write("topo-miss.snaplet", encodeSnaplet(TOPO_A, []));
      const r = run(["load", p, `--expected-topology=${TOPO_B.toString("hex")}`]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/topology mismatch/);
    });

    it("rejects malformed --expected-topology", () => {
      const p = write("topo-bad-hex.snaplet", encodeSnaplet(TOPO_A, []));
      const r = run(["load", p, "--expected-topology=not-64-hex-chars"]);
      expect(r.code).toBe(2);
    });
  });

  describe("diff", () => {
    function vcpu(entries: { name: string; value: Buffer }[]): Section {
      return { tag: SECTION_TAG.vcpu, id: 0, payload: encodeVcpuPayload(entries) };
    }

    it("returns 0 on identical files", () => {
      const bytes = encodeSnaplet(TOPO_A, [
        vcpu([{ name: "X0", value: Buffer.from([1, 2, 3, 4, 0, 0, 0, 0]) }]),
      ]);
      const a = write("diff-same-a.snaplet", bytes);
      const b = write("diff-same-b.snaplet", bytes);
      const r = run(["diff", a, b]);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("reports topology_hash mismatch", () => {
      const a = write("diff-topo-a.snaplet", encodeSnaplet(TOPO_A, []));
      const b = write("diff-topo-b.snaplet", encodeSnaplet(TOPO_B, []));
      const r = run(["diff", a, b]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/topology_hash differs/);
    });

    it("reports differing section count", () => {
      const a = write("diff-secs-a.snaplet", encodeSnaplet(TOPO_A, []));
      const b = write(
        "diff-secs-b.snaplet",
        encodeSnaplet(TOPO_A, [{ tag: SECTION_TAG.ram, id: 0, payload: Buffer.from("x") }]),
      );
      const r = run(["diff", a, b]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/section_count differs/);
    });

    it("reports payload bytes differ for non-VCPU sections", () => {
      const a = write(
        "diff-ram-a.snaplet",
        encodeSnaplet(TOPO_A, [{ tag: SECTION_TAG.ram, id: 0, payload: Buffer.from("aaa") }]),
      );
      const b = write(
        "diff-ram-b.snaplet",
        encodeSnaplet(TOPO_A, [{ tag: SECTION_TAG.ram, id: 0, payload: Buffer.from("bbb") }]),
      );
      const r = run(["diff", a, b]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/section\[0\] .* payload differs/);
    });

    it("reports a portable VCPU register diff, auto-masking classifier .mask regs", () => {
      // X0 is portable — a value diff must be reported. PMCR_EL0 is
      // classified .mask (host-relative PMU state), so the diff tool
      // skips it even with no explicit --mask flag.
      const X0_a = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
      const X0_b = Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]);
      const PMCR_a = Buffer.from([0x41, 0, 0, 0, 0, 0, 0, 0]);
      const PMCR_b = Buffer.from([0x42, 0, 0, 0, 0, 0, 0, 0]);
      const a = write(
        "diff-vcpu-a.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0_a },
            { name: "PMCR_EL0", value: PMCR_a },
          ]),
        ]),
      );
      const b = write(
        "diff-vcpu-b.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0_b },
            { name: "PMCR_EL0", value: PMCR_b },
          ]),
        ]),
      );
      const r = run(["diff", a, b]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/section\[0\]\.vcpu\.X0/);
      expect(r.stderr).not.toMatch(/PMCR_EL0/);
    });

    it("masks named VCPU entries (PMCR_EL0 differs but masked)", () => {
      const X0 = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
      const PMCR_a = Buffer.from([0x41, 0, 0, 0, 0, 0, 0, 0]);
      const PMCR_b = Buffer.from([0x42, 0, 0, 0, 0, 0, 0, 0]);
      const a = write(
        "diff-mask-a.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0 },
            { name: "PMCR_EL0", value: PMCR_a },
          ]),
        ]),
      );
      const b = write(
        "diff-mask-b.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0 },
            { name: "PMCR_EL0", value: PMCR_b },
          ]),
        ]),
      );
      const r = run(["diff", a, b, "--mask=sysreg=PMCR_EL0"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("mask does not hide a non-masked register diff", () => {
      const X0_a = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
      const X0_b = Buffer.from([9, 0, 0, 0, 0, 0, 0, 0]);
      const PMCR = Buffer.from([0x41, 0, 0, 0, 0, 0, 0, 0]);
      const a = write(
        "diff-partial-a.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0_a },
            { name: "PMCR_EL0", value: PMCR },
          ]),
        ]),
      );
      const b = write(
        "diff-partial-b.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0_b },
            { name: "PMCR_EL0", value: PMCR },
          ]),
        ]),
      );
      const r = run(["diff", a, b, "--mask=sysreg=PMCR_EL0"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/section\[0\]\.vcpu\.X0/);
    });

    it("reports register present in one file but not the other", () => {
      const X0 = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
      const a = write(
        "diff-missing-a.snaplet",
        encodeSnaplet(TOPO_A, [vcpu([{ name: "X0", value: X0 }])]),
      );
      const b = write(
        "diff-missing-b.snaplet",
        encodeSnaplet(TOPO_A, [
          vcpu([
            { name: "X0", value: X0 },
            { name: "X1", value: X0 },
          ]),
        ]),
      );
      const r = run(["diff", a, b, "--mask=sysreg="]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/section\[0\]\.vcpu\.X1.*missing in A/);
    });
  });
});
