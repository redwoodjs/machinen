import { randomBytes } from "node:crypto";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import type { VsockExecResult } from "../exec.ts";
import type { VmHandle } from "../vm-handle.ts";

const debugRestore = debugLib("machinen:restore");
const VMSTATE_RESEED_MARKER = "/run/machinen-vmstate-reseed";

/**
 * Whole-VM snapshots include the guest kernel's CSPRNG state. Without a
 * restore-time mix-in, two restores from the same bundle can hand out the same
 * post-restore secrets. Mix host entropy into the guest's input pool before
 * returning the restored handle, and leave a non-secret marker for smoke tests
 * and operators to confirm the reseed path ran.
 */
export async function reseedVmstateGuestEntropy(vm: VmHandle): Promise<"direct" | "shell"> {
  const seedHex = randomBytes(64).toString("hex");
  let mode: "direct" | "shell" = "direct";
  const res = await reseedVmstateGuestEntropyDirect(vm, seedHex).catch((err: unknown) => {
    mode = "shell";
    debugRestore(
      "direct vmstate reseed unavailable, falling back to shell helper: %s",
      err instanceof Error ? err.message : String(err),
    );
    return reseedVmstateGuestEntropyShell(vm, seedHex);
  });
  if (res.exitCode !== 0) {
    throw new BootError(
      "BOOT_VMSTATE_RESEED_FAILED",
      `restore: vmstate entropy reseed command failed (exit ${res.exitCode}).\n` +
        `stderr:\n${res.stderr}`,
    );
  }
  debugRestore("vmstate restore entropy reseeded marker=%s mode=%s", VMSTATE_RESEED_MARKER, mode);
  return mode;
}

async function reseedVmstateGuestEntropyDirect(
  vm: VmHandle,
  seedHex: string,
): Promise<VsockExecResult> {
  if (!vm.reseedVmstateEntropy) {
    throw new Error("current VM handle does not expose direct vmstate entropy reseed");
  }
  return vm.reseedVmstateEntropy(seedHex, {
    connectTimeoutMs: 1_000,
    retryMs: 25,
    execTimeoutMs: 10_000,
  });
}

async function reseedVmstateGuestEntropyShell(
  vm: VmHandle,
  seedHex: string,
): Promise<VsockExecResult> {
  const marker = `vmstate reseeded ${new Date().toISOString()}\n`;
  const cmd = [
    "mkdir -p /run",
    "test -x /sbin/machinen-vmstate-reseed",
    `/sbin/machinen-vmstate-reseed ${shellQuote(seedHex)}`,
    `printf %s ${shellQuote(marker)} > ${shellQuote(VMSTATE_RESEED_MARKER)}`,
    `chmod 0600 ${shellQuote(VMSTATE_RESEED_MARKER)}`,
  ].join(" && ");
  return vm
    .execRaw(cmd, { connectTimeoutMs: 30_000, execTimeoutMs: 10_000 })
    .catch((err: unknown) => {
      throw new BootError(
        "BOOT_VMSTATE_RESEED_FAILED",
        `restore: failed to inject vmstate restore entropy before handing the VM to the caller.\n` +
          `  The restored guest may otherwise reuse CSPRNG state from the snapshot.`,
        { cause: err },
      );
    });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
