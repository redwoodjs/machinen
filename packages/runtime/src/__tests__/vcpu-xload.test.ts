// Task #20 vCPU cross-load test.
//
// Loads the KVM-captured fresh-vCPU fixture into a fresh HVF vCPU,
// re-dumps, and asserts: every register present in both backends has
// matching bytes. Diff entries are allowed only as "missing in X"
// (the documented HVF-only / KVM-only sysreg gaps from #17).
//
// Skips on non-macOS hosts (xload --vmm=hvf needs HVF) and when the
// snapshot-test binary isn't built or entitled.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "../../../microvm/zig-out/bin/snapshot-test");
const KVM_FIXTURE = resolve(
  import.meta.dirname,
  "../../../microvm/test-fixtures/snapshot/vcpu-kvm-fresh.snaplet",
);

const READY = platform() === "darwin" && existsSync(BIN) && existsSync(KVM_FIXTURE);

let TMP: string;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "vcpu-xload-"));
});
afterAll(() => {
  if (TMP) {
    rmSync(TMP, { recursive: true, force: true });
  }
});

describe.skipIf(!READY)("vCPU cross-load (KVM dump -> HVF load -> HVF dump)", () => {
  it("preserves values for every register present on both backends", () => {
    const out = join(TMP, "xload-hvf.snaplet");
    const xload = spawnSync(BIN, ["xload", "--vmm=hvf", KVM_FIXTURE], {
      encoding: "buffer",
    });
    if (xload.status !== 0) {
      if (xload.stderr.toString().includes("hv_vm_create failed")) {
        console.warn("xload skipped: HVF entitlement missing on snapshot-test binary");
        return;
      }
      throw new Error(`xload failed: ${xload.stderr.toString().trim() || "no stderr"}`);
    }
    require("node:fs").writeFileSync(out, xload.stdout);

    const diff = spawnSync(BIN, ["diff", KVM_FIXTURE, out], { encoding: "utf8" });
    // diff exits 1 on differences; we expect non-zero because the
    // HVF/KVM sysreg enumerations don't overlap perfectly. What we
    // care about is the *kind* of difference.
    const lines = diff.stderr.split("\n").filter((l) => l.trim());
    const valueDiffs = lines.filter((l) => l.includes("value differs"));
    if (valueDiffs.length > 0) {
      throw new Error(
        `${valueDiffs.length} register(s) crossed with mismatched values:\n${valueDiffs.join("\n")}`,
      );
    }

    // Sanity: at least some entries should be "present in X, missing
    // in Y" — otherwise the xload didn't actually run (binary may be
    // unentitled or the fixture was empty).
    const missingEntries = lines.filter((l) => /missing in [AB]/.test(l));
    expect(missingEntries.length).toBeGreaterThan(0);
  });
});
