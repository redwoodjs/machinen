// #221 — per-phase wall-clock instrumentation for boot/restore/snapshot.
//
// Records (phase-name → elapsed ms) for one run, then flushes a single
// structured line so a `DEBUG=machinen:boot` (or :restore / :snapshot)
// log is one grep away from a diffable timeline:
//
//   phases kind=boot total=12345 asset-resolve=80 disk-prep=12 \
//     net-services.gvproxy=3010 net-services.cache=42 initramfs-pack=1180 \
//     rootdisk-materialize=15 vmm-spawn=23 first-guest-byte=420
//
// One line per run keeps the output regression-friendly (grep "^  machinen:boot phases "
// across two runs and diff). Phases preserve insertion order so the line
// reads like a timeline, not an alphabetised dump.
//
// Phase names use dot-separation for sub-marks
// (`net-services.gvproxy`, `net-services.cache`, …) so a top-level
// rollup and its components are both visible in the same line.

import type debugLib from "debug";
import type { PhaseLogEvent } from "./log.ts";

type DebugFn = ReturnType<typeof debugLib>;

export class PhaseTimer {
  private readonly t0: number;
  private readonly starts = new Map<string, number>();
  private readonly durations = new Map<string, number>();

  constructor() {
    this.t0 = Date.now();
  }

  /** Begin a phase. Subsequent `end(name)` records the elapsed wall-clock. */
  start(name: string): void {
    this.starts.set(name, Date.now());
  }

  /**
   * End a previously-started phase. No-op if `start` wasn't called for
   * `name` — keeps callsites that conditionally enter a phase tidy.
   */
  end(name: string): number | undefined {
    const t = this.starts.get(name);
    if (t === undefined) {
      return undefined;
    }
    const elapsed = Date.now() - t;
    this.starts.delete(name);
    this.durations.set(name, elapsed);
    return elapsed;
  }

  /**
   * Record a phase whose duration was timed externally (e.g. inherited
   * from a nested `boot()` call inside `restore()`). Skips entirely when
   * `ms` is undefined so call-sites don't have to branch.
   */
  mark(name: string, ms: number | undefined): void {
    if (ms === undefined) {
      return;
    }
    this.durations.set(name, ms);
  }

  /** Wall-clock since timer construction. */
  totalMs(): number {
    return Date.now() - this.t0;
  }

  /** Snapshot of recorded phases (insertion-ordered). */
  phases(): ReadonlyMap<string, number> {
    return this.durations;
  }

  /**
   * Format the structured one-liner. Exposed separately from `flush`
   * so tests can assert shape without piping through `debug`.
   */
  format(kind: string, totalMs?: number): string {
    const total = totalMs ?? this.totalMs();
    const parts = [`kind=${kind}`, `total=${total}`];
    for (const [name, ms] of this.durations) {
      parts.push(`${name}=${ms}`);
    }
    return `phases ${parts.join(" ")}`;
  }

  /**
   * Emit the one-liner via `debugFn`. `kind` distinguishes boot /
   * restore / snapshot in the output.
   */
  flush(debugFn: DebugFn, kind: string, totalMs?: number): void {
    debugFn("%s", this.format(kind, totalMs));
  }

  /**
   * Snapshot the timer as a structured `PhaseLogEvent` so callers can
   * forward it to an `onLog` callback without parsing the debug
   * one-liner. Returns an immutable copy of `phases` so the caller
   * holds a stable view even if the timer keeps recording.
   */
  toEvent(kind: PhaseLogEvent["kind"], totalMs?: number): PhaseLogEvent {
    return {
      source: "phase",
      kind,
      totalMs: totalMs ?? this.totalMs(),
      phases: new Map(this.durations),
    };
  }
}
