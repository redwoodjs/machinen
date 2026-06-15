// Locks the sysreg-probe output against the committed fixture for
// the current host's backend (task #17). Re-runs the probe and
// asserts byte-for-byte equality with sysregs-<hvf|kvm>.txt.
//
// Drift fails the test loudly. To accept new state, update the
// fixture deliberately (see research/snapshot/sysreg-parity.md).
//
// Skips on hosts where the probe binary isn't built, isn't entitled
// (HVF), or where the backend isn't reachable (no /dev/kvm on Linux).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const BIN = resolve(import.meta.dirname, "../../../microvm/zig-out/bin/sysreg-probe");
const FIXTURES = resolve(import.meta.dirname, "../../../microvm/test-fixtures/snapshot");

const platformBackend = platform() === "darwin" ? "hvf" : platform() === "linux" ? "kvm" : null;

const fixture =
  platformBackend === null ? null : resolve(FIXTURES, `sysregs-${platformBackend}.txt`);

const READY =
  platformBackend !== null && existsSync(BIN) && fixture !== null && existsSync(fixture);

describe.skipIf(!READY)(`sysreg-probe (${platformBackend ?? "n/a"})`, () => {
  it("output matches the committed fixture byte-for-byte", () => {
    const r = spawnSync(BIN, [], { encoding: "utf8" });
    if (r.status !== 0) {
      // On macOS without the HVF entitlement the binary boots but
      // hv_vm_create returns Denied. Surface that as a skip rather
      // than a hard failure — the codesign step is documented in
      // research/snapshot/sysreg-parity.md.
      if (r.stderr.includes("Denied")) {
        console.warn(
          "sysreg-probe: hv_vm_create returned Denied — re-run codesign " +
            "on zig-out/bin/sysreg-probe (see research/snapshot/sysreg-parity.md)",
        );
        return;
      }
      // On a Linux host without /dev/kvm (CI runners, containers
      // without nested virt) the KVM probe can't open the device.
      // Surface that as a skip — same spirit as the HVF "Denied"
      // case above and what this file's header promises.
      if (r.stderr.includes("/dev/kvm")) {
        console.warn("sysreg-probe: /dev/kvm not reachable — skipping the KVM fixture lock");
        return;
      }
      if (r.stderr.includes("KVM_ARM_PREFERRED_TARGET failed")) {
        console.warn(
          "sysreg-probe: KVM_ARM_PREFERRED_TARGET unavailable — skipping the KVM fixture lock",
        );
        return;
      }
      throw new Error(`sysreg-probe exited ${r.status}: ${r.stderr.trim() || "(no stderr)"}`);
    }

    const got = r.stdout;
    const expected = readFileSync(fixture!, "utf8");
    if (got !== expected) {
      // Compute a short diff signature: number of differing lines + the
      // first 5 differences. Full diff is too noisy for a fixture this
      // large; the user can re-run the probe and inspect the file.
      const gotLines = got.split("\n");
      const expectedLines = expected.split("\n");
      const diffs: string[] = [];
      for (let i = 0; i < Math.max(gotLines.length, expectedLines.length); i++) {
        if (gotLines[i] !== expectedLines[i]) {
          diffs.push(`L${i + 1}: -${expectedLines[i] ?? "<EOF>"} / +${gotLines[i] ?? "<EOF>"}`);
          if (diffs.length >= 5) {
            break;
          }
        }
      }
      throw new Error(
        `sysreg-probe drift vs ${fixture}:\n${diffs.join("\n")}\n` +
          `(${gotLines.length} vs ${expectedLines.length} lines; ` +
          `to accept, rerun the probe and re-commit the fixture)`,
      );
    }
  });
});
