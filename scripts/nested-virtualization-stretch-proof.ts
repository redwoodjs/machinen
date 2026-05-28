#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import {
  boot,
  buildNestedVirtualizationStretchProofRow,
  probeNestedVirtualization,
  summarizeNestedVirtualizationStretchProofRows,
  type NestedVirtualizationStretchProofRow,
} from "../packages/runtime/src/index.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const releaseAssets = resolve(repoRoot, "release-assets");

const SNAPSHOT_FORK_REFUSAL = {
  snapshotForkRefusalCode: "BOOT_VMSTATE_UNSUPPORTED",
  snapshotForkRemediation:
    "Snapshot/fork VMs created inside the nested guest instead of snapshotting the nested-enabled L1.",
};

async function main() {
  const probe = probeNestedVirtualization();
  const row = probe.supported ? await runStretchProof() : skippedRow(probe.reason ?? "unsupported");
  const summary = summarizeNestedVirtualizationStretchProofRows([row]);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass) {
    process.exitCode = 1;
  }
}

function skippedRow(reason: string): NestedVirtualizationStretchProofRow {
  return buildNestedVirtualizationStretchProofRow({
    classification: "skipped",
    l0HostArch: process.arch,
    l1GuestArch: "unavailable",
    l2GuestArch: "unavailable",
    providerMode: `${process.platform}-${process.arch}-nested-unavailable`,
    accelerated: false,
    emulated: false,
    nestedVerifierOutput: reason,
    refusalCode: "nested-virtualization-unavailable",
    remediation:
      "Run on Linux/arm64 KVM with EL2 support or macOS 15+ on M3/M4-class Apple Silicon.",
    ...SNAPSHOT_FORK_REFUSAL,
  });
}

// fallow-ignore-next-line complexity
async function runStretchProof(): Promise<NestedVirtualizationStretchProofRow> {
  const l1 = await probeL1Guest();
  const firecracker = await runFirecrackerExample();
  const l2Arch = parseL2Arch(firecracker.output);
  const ok = firecracker.status === 0 && firecracker.output.includes("firecracker-nested-ok");

  if (!ok) {
    return buildNestedVirtualizationStretchProofRow({
      classification: "refused",
      l0HostArch: process.arch,
      l1GuestArch: l1.arch,
      l2GuestArch: l2Arch ?? "unknown",
      providerMode: providerMode(l1.acceleration),
      accelerated: false,
      emulated: false,
      nestedVerifierOutput: trimVerifier(`${l1.output}\n${firecracker.output}`),
      refusalCode: "nested-smoke-failed",
      remediation:
        "Re-run the Firecracker nested guide on a nested-capable arm64 provider and keep the full verifier log.",
      evidence: { status: firecracker.status },
      ...SNAPSHOT_FORK_REFUSAL,
    });
  }

  return buildNestedVirtualizationStretchProofRow({
    classification: "stretch-demo",
    l0HostArch: process.arch,
    l1GuestArch: l1.arch,
    l2GuestArch: l2Arch ?? "aarch64",
    providerMode: providerMode(l1.acceleration),
    accelerated: l1.acceleration === "kvm",
    emulated: false,
    nestedVerifierOutput: trimVerifier(`${l1.output}\n${firecracker.output}`),
    evidence: {
      firecrackerExample: "examples/firecracker-nested/run.ts",
      snapshotForkRefusalCode: SNAPSHOT_FORK_REFUSAL.snapshotForkRefusalCode,
    },
    ...SNAPSHOT_FORK_REFUSAL,
  });
}

// fallow-ignore-next-line complexity
async function probeL1Guest(): Promise<{
  arch: string;
  acceleration: "kvm" | "missing";
  output: string;
}> {
  const vm = await boot({
    kernel: resolve(releaseAssets, "Image-arm64"),
    dtb: resolve(releaseAssets, "virt-arm64.dtb"),
    image: resolve(releaseAssets, "rootfs-debian-arm64.tar.gz"),
    nested: true,
    cmd: [
      "/bin/sh",
      "-lc",
      "printf 'l1-arch=%s\\n' \"$(uname -m)\"; if [ -c /dev/kvm ]; then echo l1-acceleration=kvm; else echo l1-acceleration=missing; exit 7; fi",
    ],
    memory: 1024,
  });
  try {
    const result = await vm.wait();
    const output = `${vm.output() ?? ""}${await vm.errorOutput()}`;
    if (result.code !== 0) {
      throw new Error(`L1 nested probe exited ${result.code}: ${output}`);
    }
    const arch = output.match(/^l1-arch=([^\s]+)/m)?.[1] ?? "unknown";
    const acceleration = output.includes("l1-acceleration=kvm") ? "kvm" : "missing";
    return { arch, acceleration, output };
  } finally {
    await vm.kill().catch(() => {});
  }
}

async function runFirecrackerExample(): Promise<{ status: number | null; output: string }> {
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", "tsx", "examples/firecracker-nested/run.ts"],
    {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [status] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  return { status, output };
}

function parseL2Arch(output: string): string | undefined {
  return output.match(/hello from firecracker L2 on ([^\s]+)/)?.[1];
}

function providerMode(l1Acceleration: "kvm" | "missing"): string {
  const l0 = process.platform === "darwin" ? "darwin-hvf" : `${process.platform}-kvm`;
  return `${l0} -> guest-${l1Acceleration} -> firecracker-kvm`;
}

function trimVerifier(output: string): string {
  const interesting = output
    .split(/\r?\n/)
    .filter((line) =>
      /l1-arch=|l1-acceleration=|hello from firecracker L2|firecracker-nested-ok|Firecracker ran inside/.test(
        line,
      ),
    )
    .join("; ");
  return interesting || output.slice(-4000);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
