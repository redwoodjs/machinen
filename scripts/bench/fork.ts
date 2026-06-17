import type { RootdiskCopyEvent } from "./metadata.ts";
import { parseRootdiskCopyEvents } from "./metadata.ts";

type RuntimeMod = typeof import("@machinen/runtime");

export interface ForkBenchAssets {
  kernel: string;
  dtb?: string;
  image: string;
}

export interface ForkBenchPhaseLine {
  kind: string;
  total: number;
  phases: Map<string, number>;
  rootdiskCopies?: RootdiskCopyEvent[];
}

export interface ForkBenchTools {
  loadRuntime(): Promise<RuntimeMod>;
  captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; captured: string }>;
  phaseLinesForKinds(captured: string, kinds: Set<string>): ForkBenchPhaseLine[];
  elapsedSinceMs(start: bigint): number;
  delay(ms: number): Promise<void>;
}

export async function runOneFork(
  assets: ForkBenchAssets,
  label: string,
  tools: ForkBenchTools,
): Promise<ForkBenchPhaseLine> {
  const timing = newForkTiming();
  const { captured } = await tools.captureStderr(async () => {
    process.stderr.write(`[${label}] booting source + forking...\n`);
    const { boot } = await tools.loadRuntime();
    const source = await boot({
      image: assets.image,
      kernel: assets.kernel,
      dtb: assets.dtb,
      cmd: ["/bin/sh", "-c", "while :; do sleep 1; done"],
      timeoutMs: 60_000,
    });
    let forked: Awaited<ReturnType<typeof source.fork>> | undefined;
    try {
      await tools.delay(1500);
      const forkStart = process.hrtime.bigint();
      forked = await source.fork({
        image: assets.image,
        kernel: assets.kernel,
        dtb: assets.dtb,
        timeoutMs: 60_000,
      });
      timing.handleMs = tools.elapsedSinceMs(forkStart);
      const execStart = process.hrtime.bigint();
      const execResult = await forked.execRaw("/bin/true", {
        connectTimeoutMs: 5_000,
        execTimeoutMs: 5_000,
      });
      timing.execAfterHandleMs = tools.elapsedSinceMs(execStart);
      timing.execReadyMs = tools.elapsedSinceMs(forkStart);
      if (execResult.exitCode !== 0) {
        throw new Error(`bench: ${label} fork readiness exec failed exit=${execResult.exitCode}`);
      }
      await tools.delay(250);
    } finally {
      await forked?.kill().catch(() => {});
      await forked?.wait().catch(() => undefined);
      await source.kill().catch(() => {});
      await source.wait().catch(() => undefined);
    }
  });
  return buildForkPhaseLine(captured, timing, tools);
}

function newForkTiming(): { handleMs: number; execAfterHandleMs: number; execReadyMs: number } {
  return { handleMs: 0, execAfterHandleMs: 0, execReadyMs: 0 };
}

function buildForkPhaseLine(
  captured: string,
  timing: { handleMs: number; execAfterHandleMs: number; execReadyMs: number },
  tools: Pick<ForkBenchTools, "phaseLinesForKinds">,
): ForkBenchPhaseLine {
  const phases = new Map<string, number>();
  phases.set("handle", Math.round(timing.handleMs));
  phases.set("exec-after-handle", Math.round(timing.execAfterHandleMs));
  phases.set("exec-ready", Math.round(timing.execReadyMs));
  copyPrefixedPhases(phases, "snapshot", lastPhase(captured, "snapshot", tools));
  copyPrefixedPhases(phases, "restore", forkRestoreLine(captured, tools));
  return {
    kind: "fork",
    total: Math.round(timing.handleMs),
    phases,
    rootdiskCopies: parseRootdiskCopyEvents(captured),
  };
}

function forkRestoreLine(
  captured: string,
  tools: Pick<ForkBenchTools, "phaseLinesForKinds">,
): ForkBenchPhaseLine | undefined {
  const restore = lastPhase(captured, "restore", tools);
  if (!restore) {
    return undefined;
  }
  const phases = new Map<string, number>(restore.phases);
  appendBootRestorePhases(phases, captured, tools);
  appendVmstateApplyPhase(phases, captured);
  return { kind: "restore", total: restore.total, phases };
}

function appendBootRestorePhases(
  phases: Map<string, number>,
  captured: string,
  tools: Pick<ForkBenchTools, "phaseLinesForKinds">,
): void {
  const boot = lastPhase(captured, "boot", tools);
  if (!boot) {
    return;
  }
  phases.set("boot-to-first-guest-byte", boot.total);
  phases.set("boot.total", boot.total);
  for (const [key, value] of boot.phases) {
    phases.set(`boot.${key}`, value);
  }
}

function appendVmstateApplyPhase(phases: Map<string, number>, captured: string): void {
  const vmstateApply = parseVmstateRestoreTotal(captured);
  if (vmstateApply !== undefined) {
    phases.set("vmstate-apply", vmstateApply);
  }
}

function lastPhase(
  captured: string,
  kind: string,
  tools: Pick<ForkBenchTools, "phaseLinesForKinds">,
): ForkBenchPhaseLine | undefined {
  return tools.phaseLinesForKinds(captured, new Set([kind])).at(-1);
}

function copyPrefixedPhases(
  target: Map<string, number>,
  prefix: string,
  source: ForkBenchPhaseLine | undefined,
): void {
  if (!source) {
    return;
  }
  target.set(`${prefix}.total`, source.total);
  for (const [key, value] of source.phases) {
    target.set(`${prefix}.${key}`, value);
  }
}

function parseVmstateRestoreTotal(captured: string): number | undefined {
  for (const line of captured.split("\n").reverse()) {
    const match = /vmstate restore timing .*event=done total_ms=(\d+)/.exec(line);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }
  return undefined;
}
