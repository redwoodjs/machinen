#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

import {
  boot,
  buildOppositeIsaVmExecutionSummary,
  classifyOppositeIsaProviderRoute,
  hostArchitectureFromNode,
  oppositeGuestArchitecture,
  resolveBaseDtb,
  resolveBaseKernel,
  resolveBaseRootfs,
  type OppositeIsaVmExecutionArch,
  type OppositeIsaVmExecutionEvidence,
  type OppositeIsaVmExecutionSummary,
} from "../packages/runtime/src/index.ts";

interface Options {
  guestArch?: OppositeIsaVmExecutionArch;
  json: boolean;
  summary?: string;
  live: boolean;
  fixture?: "host-sidecar" | "completed";
}

function usage(): never {
  console.error(
    "usage: tsx scripts/opposite-isa-vm-execution.ts [--guest-arch arm64|amd64] [--live] [--fixture host-sidecar|completed] [--summary file] [--json]",
  );
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Options {
  const options: Options = { json: false, live: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--live") {
      options.live = true;
      continue;
    }
    if (arg === "--guest-arch") {
      options.guestArch = parseArch(argv[++index]);
      continue;
    }
    if (arg === "--summary") {
      options.summary = valueAt(argv, ++index);
      continue;
    }
    if (arg === "--fixture") {
      const fixture = valueAt(argv, ++index);
      if (fixture !== "host-sidecar" && fixture !== "completed") {
        usage();
      }
      options.fixture = fixture;
      continue;
    }
    usage();
  }
  return options;
}

function valueAt(argv: string[], index: number): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

function parseArch(value: string | undefined): OppositeIsaVmExecutionArch {
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  usage();
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const hostArch = hostArchitectureFromNode();
  const guestArch = options.guestArch ?? oppositeGuestArchitecture(hostArch);
  const summary = options.fixture
    ? fixtureSummary(options.fixture, hostArch, guestArch)
    : await routeSummary({ hostArch, guestArch, live: options.live });
  if (options.summary) {
    writeFileSync(resolve(options.summary), `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(
      `opposite-isa-vm-execution: ${summary.state} ${summary.hostArch}->${summary.guestArch} ${summary.providerMode}\n`,
    );
  }
  if (summary.state === "refused") {
    process.exitCode = 1;
  }
}

// fallow-ignore-next-line complexity
async function routeSummary(input: {
  hostArch: OppositeIsaVmExecutionArch;
  guestArch: OppositeIsaVmExecutionArch;
  live: boolean;
}): Promise<OppositeIsaVmExecutionSummary> {
  const route = classifyOppositeIsaProviderRoute({
    hostArch: input.hostArch,
    guestArch: input.guestArch,
    platform: platform(),
    hasKvm: existsSync("/dev/kvm"),
    emulationAvailable: process.env.MACHINEN_OPPOSITE_ISA_EMULATION === "1",
  });
  const rootfsDigest = rootfsDigestFor(input.guestArch);
  if (!input.live || !route.available) {
    return buildOppositeIsaVmExecutionSummary({
      hostArch: route.hostArch,
      guestArch: route.guestArch,
      providerMode: route.providerMode,
      accelerated: route.accelerated,
      emulated: route.emulated,
      rootfsDigest,
      verifierSource: "unknown",
      routeAvailable: input.live ? route.available : false,
      unavailableReason: input.live ? route.unavailableReason : "opposite-isa-provider-unavailable",
      remediation: input.live
        ? route.remediation
        : "Re-run with --live on a host/provider that supports the requested opposite-ISA guest route.",
    });
  }

  const previousGuestArch = process.env.MACHINEN_GUEST_ARCH;
  process.env.MACHINEN_GUEST_ARCH = input.guestArch;
  try {
    return await liveRouteSummary(route, rootfsDigest);
  } finally {
    if (previousGuestArch === undefined) {
      delete process.env.MACHINEN_GUEST_ARCH;
    } else {
      process.env.MACHINEN_GUEST_ARCH = previousGuestArch;
    }
  }
}

// fallow-ignore-next-line complexity
async function liveRouteSummary(
  route: ReturnType<typeof classifyOppositeIsaProviderRoute>,
  rootfsDigest: string | null,
): Promise<OppositeIsaVmExecutionSummary> {
  let rootfs: string;
  let kernel: string;
  let dtb: string | undefined;
  try {
    rootfs = resolveBaseRootfs();
    kernel = resolveBaseKernel();
    dtb = resolveBaseDtb();
  } catch (error) {
    return buildOppositeIsaVmExecutionSummary({
      ...routeEvidence(route),
      rootfsDigest,
      verifierSource: "unknown",
      routeAvailable: true,
      unavailableReason: "opposite-isa-assets-missing",
      remediation: error instanceof Error ? error.message : "guest assets are unavailable",
    });
  }

  const name = `opposite-isa-${route.hostArch}-to-${route.guestArch}-${process.pid}`;
  try {
    const vm = await boot({
      image: rootfs,
      kernel,
      dtb,
      name,
      cmd: ["sleep", "100000"],
      snapshot: false,
      timeoutMs: 90_000,
    });
    try {
      const probe = await vm.execRaw(guestProbeCommand(), { execTimeoutMs: 30_000 });
      const parsed = parseGuestProbe(probe.stdout);
      return buildOppositeIsaVmExecutionSummary({
        ...routeEvidence(route),
        kernelVersion: parsed.kernelVersion,
        rootfsDigest,
        guestUnameMachine: parsed.guestUnameMachine,
        guestElfMachine: parsed.guestElfMachine,
        verifierOutput: probe.stdout.trim(),
        verifierSource: probe.exitCode === 0 ? "guest-exec" : "unknown",
        routeAvailable: true,
      });
    } finally {
      await vm.kill().catch(() => {});
    }
  } catch (error) {
    return buildOppositeIsaVmExecutionSummary({
      ...routeEvidence(route),
      rootfsDigest,
      verifierSource: "unknown",
      routeAvailable: false,
      unavailableReason: "opposite-isa-boot-failed",
      remediation: error instanceof Error ? error.message : "opposite-ISA boot failed",
    });
  }
}

function routeEvidence(route: ReturnType<typeof classifyOppositeIsaProviderRoute>) {
  return {
    hostArch: route.hostArch,
    guestArch: route.guestArch,
    providerMode: route.providerMode,
    accelerated: route.accelerated,
    emulated: route.emulated,
  } satisfies Pick<
    OppositeIsaVmExecutionEvidence,
    "hostArch" | "guestArch" | "providerMode" | "accelerated" | "emulated"
  >;
}

function guestProbeCommand(): string {
  return String.raw`set -eu
uname_m=$(uname -m)
kernel=$(uname -r)
elf=$((file -b /bin/uname 2>/dev/null || readelf -h /bin/uname 2>/dev/null | grep 'Machine:' || true) | tr '\n' ' ')
ran=$(/bin/uname -m)
printf 'guestUnameMachine=%s\n' "$uname_m"
printf 'kernelVersion=%s\n' "$kernel"
printf 'guestElfMachine=%s\n' "$elf"
printf 'verifier=guest-exec:/bin/uname:%s\n' "$ran"
`;
}

// fallow-ignore-next-line complexity
function parseGuestProbe(stdout: string): {
  guestUnameMachine: string | null;
  guestElfMachine: string | null;
  kernelVersion: string | null;
} {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const index = line.indexOf("=");
    if (index > 0) {
      fields.set(line.slice(0, index), line.slice(index + 1));
    }
  }
  return {
    guestUnameMachine: fields.get("guestUnameMachine") ?? null,
    guestElfMachine: fields.get("guestElfMachine") ?? null,
    kernelVersion: fields.get("kernelVersion") ?? null,
  };
}

// fallow-ignore-next-line complexity
function fixtureSummary(
  fixture: "host-sidecar" | "completed",
  hostArch: OppositeIsaVmExecutionArch,
  guestArch: OppositeIsaVmExecutionArch,
): OppositeIsaVmExecutionSummary {
  const providerMode = fixture === "completed" ? "fixture-explicit-emulation" : "fixture-invalid";
  return buildOppositeIsaVmExecutionSummary({
    hostArch,
    guestArch,
    providerMode,
    accelerated: false,
    emulated: fixture === "completed",
    kernelVersion: "6.8.0-fixture",
    rootfsDigest: "f".repeat(64),
    guestUnameMachine: guestArch === "amd64" ? "x86_64" : "aarch64",
    guestElfMachine:
      guestArch === "amd64"
        ? "ELF 64-bit LSB executable, x86-64"
        : "ELF 64-bit LSB executable, ARM aarch64",
    verifierOutput:
      fixture === "completed"
        ? `fixture guest exec for ${guestArch}`
        : `host uname says ${hostArch}; this must not count for ${guestArch}`,
    verifierSource: fixture === "completed" ? "guest-exec" : "host-sidecar",
    routeAvailable: true,
  });
}

function rootfsDigestFor(guestArch: OppositeIsaVmExecutionArch): string | null {
  const rootfs = candidateRootfsPaths(guestArch).find((path) => existsSync(path));
  return rootfs ? sha256File(rootfs) : null;
}

function candidateRootfsPaths(guestArch: OppositeIsaVmExecutionArch): string[] {
  const assets = process.env.MACHINEN_ASSETS_DIR;
  const paths: string[] = [];
  if (assets) {
    paths.push(resolve(assets, `rootfs-debian-${guestArch}.tar.gz`));
    if (guestArch === "arm64") {
      paths.push(resolve(assets, "rootfs-debian-arm64.tar.gz"));
    }
  }
  const runtimePkg = JSON.parse(readFileSync(resolve("packages/runtime/package.json"), "utf8")) as {
    version: string;
  };
  paths.push(
    join(
      homedir(),
      ".machinen",
      `runtime-v${runtimePkg.version}`,
      "bases",
      `debian-${guestArch}`,
      "rootfs.tar.gz",
    ),
  );
  return paths;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

await main();
