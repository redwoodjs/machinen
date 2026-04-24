// Shared streaming-log surface — see #83.
//
// APIs that run work (boot, provision, vm.snapshot, attach) take an
// `onLog` callback. It fires for every byte of output the guest emits,
// tagged by source so a caller can tell kernel-console bytes from exec
// bytes without having to stitch callbacks onto every vm.exec().
//
// vm.exec / vm.execRaw keep their narrower {onStdout, onStderr} option
// — one command, two pipes is a cleaner shape there. Callers wiring an
// onLog at boot-level get exec output too: the handle tees each exec
// into the onLog under the `exec-stdout` / `exec-stderr` sources with
// the command string set on `cmd`.

export interface LogEvent {
  /**
   * Where the chunk came from:
   *   - `guest-console` — kernel / PL011 console bytes (VMM stderr)
   *   - `exec-stdout`   — stdout of an exec invocation
   *   - `exec-stderr`   — stderr of an exec invocation
   */
  source: "guest-console" | "exec-stdout" | "exec-stderr";
  /** Command string; set when `source` is `exec-stdout` or `exec-stderr`. */
  cmd?: string;
  /** Raw bytes as they arrive — not line-split, not decoded. */
  chunk: Buffer;
}

export type OnLog = (evt: LogEvent) => void;
