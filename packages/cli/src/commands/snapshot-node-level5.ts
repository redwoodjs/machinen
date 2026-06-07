import {
  createNodeLevel5ProductSnapshot,
  type NodeLevel5ProductSnapshotDirection,
  type RegistryEntry,
} from "@machinen/runtime";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { consumeJsonFlag, emitJson } from "../args.ts";
import { die } from "../errors.ts";
import type { Target } from "../parse-target.ts";
import { takeCaptureValue } from "./node-level5-shared.ts";
import { lookupEntry } from "./target.ts";

type NodeLevel5ProductSnapshotCliOptions = {
  out?: string;
  target?: Target;
};

type RequiredNodeLevel5SnapshotOptions = {
  out: string;
  target: Target;
};

type NodeLevel5ProductSnapshotTargetMetadata = {
  runtime?: "node" | "unknown";
  appDir?: string;
  pid?: number;
  argv?: string;
  executable?: string;
};

export function isNodeLevel5HostPidHarnessSnapshotCommand(args: string[]): boolean {
  return allowNodeLevel5HostPidHarnessTarget() && isNodeLevel5HostPidHarnessShape(args);
}

function isNodeLevel5HostPidHarnessShape(args: string[]): boolean {
  return args[0] === "node" && isDigitsOnly(args[1]) && args.includes("--out");
}

function isDigitsOnly(value: string | undefined): boolean {
  return /^[0-9]+$/.test(value ?? "");
}

export async function cmdSnapshotNodeLevel5HostPidHarness(args: string[]): Promise<number> {
  const { json, rest } = consumeJsonFlag(args);
  const options = requireNodeLevel5HostPidHarnessOptions(rest.filter((arg) => arg !== "node"));
  return runNodeLevel5HostPidHarnessSnapshot({ ...options, target: options.target }, json);
}

function requireNodeLevel5HostPidHarnessOptions(
  args: string[],
): RequiredNodeLevel5SnapshotOptions & { target: { pid: number } } {
  const options = parseNodeLevel5ProductSnapshotArgs(args);
  if (!options.out || !options.target || !("pid" in options.target)) {
    die(
      "usage: MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1 machinen snapshot node <host-pid> --out <dir> [--json]",
    );
  }
  return { out: options.out, target: options.target };
}

function runNodeLevel5HostPidHarnessSnapshot(
  options: RequiredNodeLevel5SnapshotOptions & { target: { pid: number } },
  json: boolean,
): number {
  if (!allowNodeLevel5HostPidHarnessTarget()) {
    die("usage: machinen snapshot <vm-name> --out <dir> [--json]");
  }
  return reportNodeLevel5ProductSnapshot(
    createNodeLevel5ProductSnapshot({
      outDir: resolve(options.out),
      target: resolveNodeLevel5ProductSnapshotTarget(options.target),
      direction: nodeLevel5ProductSnapshotDirectionOverride(),
    }),
    json,
  );
}

function allowNodeLevel5HostPidHarnessTarget(): boolean {
  // Diagnostic/release-corpus harness only. The public product surface is
  // `machinen snapshot <vm-name> --out <dir>` and detects Node inside the VM.
  return process.env.MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT === "1";
}

function nodeLevel5ProductSnapshotDirectionOverride():
  | NodeLevel5ProductSnapshotDirection
  | undefined {
  const direction = process.env.MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION;
  if (!direction) {
    return undefined;
  }
  if (direction === "arm64-to-amd64" || direction === "amd64-to-arm64") {
    return direction;
  }
  die(
    "invalid MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION; expected arm64-to-amd64 or amd64-to-arm64",
  );
}

function reportNodeLevel5ProductSnapshot(
  summary: ReturnType<typeof createNodeLevel5ProductSnapshot>,
  json: boolean,
): number {
  if (json) {
    emitJson(summary);
    return summary.accepted ? 0 : 1;
  }
  writeNodeLevel5ProductSnapshotHumanSummary(summary);
  return summary.accepted ? 0 : 1;
}

function writeNodeLevel5ProductSnapshotHumanSummary(
  summary: ReturnType<typeof createNodeLevel5ProductSnapshot>,
): void {
  if (summary.accepted) {
    process.stdout.write(`snapshot written: ${summary.snapshotDir}\n`);
    return;
  }
  process.stderr.write(`machinen snapshot: ${summary.refusal?.message}\n`);
}

function parseNodeLevel5ProductSnapshotArgs(args: string[]): NodeLevel5ProductSnapshotCliOptions {
  const outFlag = args.indexOf("--out");
  if (outFlag === -1) {
    return parseNodeLevel5ProductSnapshotTargetOnly(args);
  }
  const out = takeCaptureValue(args, outFlag + 1, "--out");
  const positional = args.filter((_, index) => index !== outFlag && index !== outFlag + 1);
  return { out, target: parseNodeLevel5ProductSnapshotTargetOnly(positional).target };
}

function parseNodeLevel5ProductSnapshotTargetOnly(
  args: string[],
): Pick<NodeLevel5ProductSnapshotCliOptions, "target"> {
  if (args.length === 0) {
    return {};
  }
  if (args.length > 1) {
    die(`unknown snapshot host-pid harness argument: ${args[1]}`);
  }
  return { target: /^[0-9]+$/.test(args[0]!) ? { pid: Number(args[0]) } : { name: args[0]! } };
}

function resolveNodeLevel5ProductSnapshotTarget(target: Target) {
  const entry = lookupEntry(target);
  const pid = nodeLevel5ProductSnapshotTargetPid(target, entry);
  return {
    target: nodeLevel5ProductSnapshotTargetName(target),
    targetKind: nodeLevel5ProductSnapshotTargetKind(target),
    pid,
    registryMatched: Boolean(entry),
    ...nodeLevel5ProductSnapshotTargetEvidence(pid),
  };
}

function nodeLevel5ProductSnapshotTargetEvidence(
  pid: number | undefined,
): NodeLevel5ProductSnapshotTargetMetadata {
  if (!pid) {
    return { runtime: "unknown" };
  }
  return inspectNodeLevel5ProductSnapshotPid(pid);
}

function nodeLevel5ProductSnapshotTargetName(target: Target): string {
  return "name" in target ? target.name : String(target.pid);
}

function nodeLevel5ProductSnapshotTargetKind(target: Target): "name" | "pid" {
  return "name" in target ? "name" : "pid";
}

function nodeLevel5ProductSnapshotTargetPid(
  target: Target,
  entry: RegistryEntry | undefined,
): number | undefined {
  return "pid" in target ? target.pid : entry?.pid;
}

function inspectNodeLevel5ProductSnapshotPid(pid: number): NodeLevel5ProductSnapshotTargetMetadata {
  const executable = readProcessField(pid, "comm");
  const argv = readProcessField(pid, "args");
  return {
    runtime: isNodeLevel5ProductSnapshotNodeProcess(executable, argv) ? "node" : "unknown",
    appDir: readProcessCwd(pid),
    pid,
    executable,
    argv,
  };
}

function readProcessField(pid: number, field: "comm" | "args"): string | undefined {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function readProcessCwd(pid: number): string | undefined {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .find((line) => line.startsWith("n"))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

function isNodeLevel5ProductSnapshotNodeProcess(
  executable: string | undefined,
  argv: string | undefined,
): boolean {
  return /(^|\/)node(?:$|\s)/u.test(executable ?? "") || /(^|\s)node(?:$|\s)/u.test(argv ?? "");
}
