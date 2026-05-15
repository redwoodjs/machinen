// Cross-host vCPU round trip (tasks #34, #35).
//
// Mac→Linux→Mac and Linux→Mac→Linux. Both directions must produce
// a bit-exact diff under the classifier-aware mask. Requires:
//   - macOS host with snapshot-test built + entitled (HVF)
//   - ssh access to a Linux/arm64 host with snapshot-test deployed
//     at /tmp/snapshot-test
//   - env MACHINEN_CROSS_VMM_SNAPSHOT_HOST=<user@host>
//
// Skipped unless both prereqs hold — this test runs on demand, not
// in the default suite.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import { afterAll, beforeAll, describe, it } from "vitest";

const BIN = resolve(import.meta.dirname, "../../../microvm/zig-out/bin/snapshot-test");

const REMOTE = process.env.MACHINEN_CROSS_VMM_SNAPSHOT_HOST ?? "";

const READY = platform() === "darwin" && existsSync(BIN) && REMOTE.length > 0;

let TMP: string;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "cross-host-rt-"));
});
afterAll(() => {
  if (TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

function sh(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function countValueDiffs(out: { stdout: string; stderr: string }): number {
  return (out.stderr.match(/value differs/g) || []).length;
}

describe.skipIf(!READY)("cross-host vCPU round trip", () => {
  it("Mac -> Linux -> Mac is bit-exact under classifier mask", { timeout: 60_000 }, () => {
    const macOrig = join(TMP, "mac-orig.vmstate");
    const macBack = join(TMP, "mac-back.vmstate");

    // Step 1: dump fresh HVF vCPU on Mac.
    let r = sh("sh", ["-c", `${BIN} dump --vmm=hvf --section=vcpu > ${macOrig}`]);
    if (r.code !== 0) {
      return;
    } // skip if HVF entitlement missing

    // Step 2: ship to Linux, xload via KVM, ship back.
    const linuxRoundtripped = join(TMP, "linux-rt.vmstate");
    r = sh("scp", [macOrig, `${REMOTE}:/tmp/cross-rt-mac-orig.vmstate`]);
    if (r.code !== 0) {
      throw new Error(`scp to Linux failed: ${r.stderr}`);
    }
    r = sh("ssh", [
      REMOTE,
      "/tmp/snapshot-test xload --vmm=kvm /tmp/cross-rt-mac-orig.vmstate > /tmp/cross-rt-linux-rt.vmstate",
    ]);
    if (r.code !== 0) {
      throw new Error(`xload on Linux failed: ${r.stderr}`);
    }
    r = sh("scp", [`${REMOTE}:/tmp/cross-rt-linux-rt.vmstate`, linuxRoundtripped]);
    if (r.code !== 0) {
      throw new Error(`scp from Linux failed: ${r.stderr}`);
    }

    // Step 3: load on Mac into a fresh HVF vCPU, dump back.
    r = sh("sh", ["-c", `${BIN} xload --vmm=hvf ${linuxRoundtripped} > ${macBack}`]);
    if (r.code !== 0) {
      throw new Error(`xload on Mac failed: ${r.stderr}`);
    }

    // Diff: classifier-aware. Zero value-differs = bit-exact RT.
    const diff = sh(BIN, ["diff", macOrig, macBack]);
    const valueDiffs = countValueDiffs(diff);
    if (valueDiffs !== 0) {
      throw new Error(
        `${valueDiffs} regs drifted across Mac->Linux->Mac:\n${diff.stderr
          .split("\n")
          .filter((l) => l.includes("value differs"))
          .join("\n")}`,
      );
    }
  });

  it("Linux -> Mac -> Linux is bit-exact under classifier mask", { timeout: 60_000 }, () => {
    const linuxOrig = join(TMP, "linux-orig.vmstate");
    const linuxBack = join(TMP, "linux-back.vmstate");

    // Step 1: dump fresh KVM vCPU on Linux.
    let r = sh("ssh", [
      REMOTE,
      "/tmp/snapshot-test dump --vmm=kvm --section=vcpu > /tmp/cross-rt-linux-orig.vmstate",
    ]);
    if (r.code !== 0) {
      throw new Error(`dump on Linux failed: ${r.stderr}`);
    }
    r = sh("scp", [`${REMOTE}:/tmp/cross-rt-linux-orig.vmstate`, linuxOrig]);
    if (r.code !== 0) {
      throw new Error(`scp from Linux failed: ${r.stderr}`);
    }

    // Step 2: xload on Mac (HVF), ship back.
    const macRoundtripped = join(TMP, "mac-rt.vmstate");
    r = sh("sh", ["-c", `${BIN} xload --vmm=hvf ${linuxOrig} > ${macRoundtripped}`]);
    if (r.code !== 0) {
      throw new Error(`xload on Mac failed: ${r.stderr}`);
    }
    r = sh("scp", [macRoundtripped, `${REMOTE}:/tmp/cross-rt-mac-rt.vmstate`]);
    if (r.code !== 0) {
      throw new Error(`scp to Linux failed: ${r.stderr}`);
    }

    // Step 3: load on Linux into a fresh KVM vCPU, dump back.
    r = sh("ssh", [
      REMOTE,
      "/tmp/snapshot-test xload --vmm=kvm /tmp/cross-rt-mac-rt.vmstate > /tmp/cross-rt-linux-back.vmstate",
    ]);
    if (r.code !== 0) {
      throw new Error(`xload on Linux failed: ${r.stderr}`);
    }
    r = sh("scp", [`${REMOTE}:/tmp/cross-rt-linux-back.vmstate`, linuxBack]);
    if (r.code !== 0) {
      throw new Error(`scp from Linux failed: ${r.stderr}`);
    }

    const diff = sh(BIN, ["diff", linuxOrig, linuxBack]);
    const valueDiffs = countValueDiffs(diff);
    if (valueDiffs !== 0) {
      throw new Error(
        `${valueDiffs} regs drifted across Linux->Mac->Linux:\n${diff.stderr
          .split("\n")
          .filter((l) => l.includes("value differs"))
          .join("\n")}`,
      );
    }
  });
});
