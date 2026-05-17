// Quiet boot/restore UX with diagnostics-on-failure — #286.
//
// The cold boot and snapshot-restore paths stream a lot of detail
// (kernel printk, init.zig checkpoints, machinen-restore.sh
// mechanics) that's useful when building or debugging a VM but
// noise for an end-user just trying to run one. This module
// implements the "quiet headline + dump-on-failure" envelope used by
// every command in the CLI:
//
//   1. `isQuiet()` — true unless any DEBUG=machinen:* namespace is
//      live. The runtime's `debug` calls already self-gate, so this
//      mirrors that gate at the CLI layer: with DEBUG set the user
//      opted into noise and we get out of the way.
//
//   2. `RingBuffer` — capped FIFO of stderr chunks. Feed it from an
//      `onLog` (or a manual `.push()`) so failure paths have the
//      relevant tail context regardless of how much output came
//      before. Capped at 64 KiB which holds ~roughly the last 1k
//      lines — enough for a CRIU restore failure or a panicking
//      guest, well under the 1 MiB the runtime's own collect() caps.
//
//   3. `NoiseFilter` — a line splitter over guest-console bytes that
//      routes each line to either the ring buffer (boot noise) or
//      stderr (workload output). Recognises the prefixes the guest
//      init and restore scripts emit. The first non-noise line is
//      the readiness boundary — that's when we print "guest ready"
//      / "ready in <t>s" and from there it's pure pass-through.
//      Content-based rather than vsock-probe-based because one-shot
//      workloads (e.g. `boot -- echo hello`) can exit before any
//      probe could fire.
//
//   4. `printDiagnostics()` — the "--- diagnostics ---" envelope.
//      Dumps the buffer + any labeled tails the caller hands in
//      (e.g. restore.log) and tails the escape-hatch hint.
//
// DEBUG=machinen:* bypasses every quiet path — `vm.stderr.pipe`
// stays direct, headlines are skipped, and the diagnostics dumper
// turns into a no-op. This is the operator escape hatch the issue
// calls out: "it's stuck, show me now."

import debugLib from "debug";

const cliDebug = debugLib("machinen:cli");

/**
 * Quiet mode is on unless any `machinen:*` debug namespace is
 * enabled. Mirrors the runtime's own debug gate so users who
 * opted into verbose runtime logs also get verbose CLI flow.
 *
 * Implementation: scan `process.env.DEBUG` for any positive entry
 * that targets a `machinen` namespace (or `*`, the wildcard that
 * catches every namespace). The `debug` library reads DEBUG once
 * at require time; reading it again here lets tests flip behavior
 * via `vi.stubEnv("DEBUG", …)` without restarting the process.
 */
export function isQuiet(): boolean {
  const env = process.env.DEBUG;
  if (!env) {
    return true;
  }
  for (const raw of env.split(/[\s,]+/)) {
    const entry = raw.trim();
    if (!entry) {
      continue;
    }
    // Leading `-` disables a namespace (e.g. `*,-machinen:*` to
    // enable everything *except* machinen). Those don't count as
    // an opt-in for the namespace.
    if (entry.startsWith("-")) {
      continue;
    }
    if (entry === "*") {
      return false;
    }
    if (entry === "machinen" || entry.startsWith("machinen:")) {
      return false;
    }
  }
  return true;
}

// 64 KiB holds ~1k typical kernel/init lines on the noisy boot
// path, which is well over what a failure dump needs. Below the
// runtime-side `CONSOLE_TAIL_BYTES` (1 MiB) so we never duplicate
// its work — the runtime collector remains the source of truth for
// post-mortem tails on a thrown error.
export const BUFFER_BYTES = 64 * 1024;

export class RingBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private cap = BUFFER_BYTES) {}

  push(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (buf.length === 0) {
      return;
    }
    this.chunks.push(buf);
    this.size += buf.length;
    while (this.size > this.cap && this.chunks.length > 1) {
      const drop = this.chunks.shift()!;
      this.size -= drop.length;
    }
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  byteLength(): number {
    return this.size;
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.size).toString("utf8");
  }
}

// Lines that match these prefixes are boot-time noise: kernel
// printk, guest /init checkpoints, the machinen-* userspace
// helpers. Everything else is treated as workload output and
// passes through to the user immediately.
const NOISE_PREFIXES: ReadonlyArray<RegExp> = [
  /^\[\s*\d+\.\d+\]/, // kernel printk: "[    0.123456] ..."
  /^=== machinen \/init:/,
  /^init:/,
  /^checkpoint:/,
  /^mountdisk:/,
  /^machinen-restore:/,
  /^machinen-supervisor:/,
  /^supervisor:/,
  /^machinen-dump:/,
  /^machinen-netup:/,
  /^topology:/,
  /^vsock:/,
  /^(?:hvf|kvm)(?: [^:]+)?:/,
];

export function isBootNoiseLine(line: string): boolean {
  const visible = stripAnsiControl(line).trimStart();
  if (visible.includes("reboot: Power down")) {
    return false;
  }
  return NOISE_PREFIXES.some((re) => re.test(visible));
}

const ESC = String.fromCharCode(27);
const CR = String.fromCharCode(13);
const CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

function stripAnsiControl(text: string): string {
  return text.replace(CSI_RE, "").split(CR).join("");
}

function isLikelyInteractivePrompt(text: string): boolean {
  // Bash prompts are intentionally not newline-terminated. In quiet
  // mode, waiting for LF means the user sees only the final boot-noise
  // line (`supervisor: starting ...`) until they press Enter, at which
  // point the prompt finally flushes. Detect the common Debian/root
  // prompt shape (`root@host:/#`, `dev@host:/path$`) and pass it
  // through immediately while still keeping arbitrary partial boot
  // noise line-buffered. Readline may prefix the prompt with ANSI CSI
  // controls such as bracketed-paste enable (`\x1b[?2004h`), so match
  // against the visible text but pass the original bytes through.
  return /^[^\s@]+@[^\s:]+:[^\n\r]*[#$] ?$/.test(stripAnsiControl(text));
}

interface NoiseFilterOpts {
  /** Sink for boot-noise lines. */
  buffer: RingBuffer;
  /** Stream to write pass-through (workload) lines to. */
  out: NodeJS.WritableStream;
  /**
   * Fires once, on the first line that isn't boot noise — the
   * readiness boundary. Caller uses this to print the "guest ready"
   * headline before the workload's first line lands.
   */
  onReady?: () => void;
}

/**
 * Pre-ready line-buffered filter over guest-console chunks. Each
 * complete line (LF-terminated, or the residual on flush) is
 * classified as boot noise (→ buffer) or workload output (→ stderr).
 * The first workload line flips the gate and triggers `onReady`; after
 * that, bytes pass through immediately so interactive echo is not held
 * until Enter.
 *
 * Chunks may split lines mid-byte before readiness; the filter holds
 * the residual until the next chunk completes it. Call `.flush()` once
 * on VM exit to drain any trailing partial line — guest output that
 * ended without a newline (rare but real for early panics).
 */
export class NoiseFilter {
  private residual = "";
  private readyFired = false;

  constructor(private readonly opts: NoiseFilterOpts) {}

  push(chunk: Buffer): void {
    const text = chunk.toString("utf8");
    if (this.readyFired) {
      this.passThrough(text);
      return;
    }

    const combined = this.residual + text;
    const nlIdx = combined.lastIndexOf("\n");
    if (nlIdx === -1) {
      if (isLikelyInteractivePrompt(combined)) {
        this.residual = "";
        this.routeLine(combined, "");
        return;
      }
      this.residual = combined;
      return;
    }
    const complete = combined.slice(0, nlIdx + 1);
    this.residual = combined.slice(nlIdx + 1);
    for (const line of splitLines(complete)) {
      this.routeLine(line, "\n");
    }
    if (this.readyFired && this.residual.length > 0) {
      const tail = this.residual;
      this.residual = "";
      this.passThrough(tail);
    }
  }

  /**
   * Flush any residual partial line. Treats it as a boot-noise line
   * if we're still pre-ready, otherwise passes it through. Idempotent.
   */
  flush(): void {
    if (this.residual.length === 0) {
      return;
    }
    const tail = this.residual;
    this.residual = "";
    this.routeLine(tail, "");
  }

  private routeLine(line: string, terminator: string): void {
    if (line.length === 0 && terminator === "") {
      return;
    }
    if (!this.readyFired && isBootNoiseLine(line)) {
      this.opts.buffer.push(line + terminator);
      return;
    }
    // First non-noise line flips the gate. Empty / control-only lines
    // pre-ready (a stray blank line in init.zig output, or CR padding
    // from the serial console) stay buffered so we don't fire ready on
    // whitespace.
    if (!this.readyFired) {
      if (stripAnsiControl(line).trim().length === 0) {
        this.opts.buffer.push(line + terminator);
        return;
      }
      this.readyFired = true;
      try {
        this.opts.onReady?.();
      } catch (err) {
        cliDebug("NoiseFilter onReady threw err=%o", err);
      }
    }
    // Post-ready: pass through AND keep buffering (rolling tail)
    // so a workload that crashes minutes in still has context
    // for the failure dump.
    this.passThrough(line + terminator);
  }

  private passThrough(text: string): void {
    this.opts.out.write(text);
    this.opts.buffer.push(text);
  }

  get ready(): boolean {
    return this.readyFired;
  }
}

function splitLines(text: string): string[] {
  // Preserve LF-terminated splits without trailing empty entries
  // when `text` itself ends with LF (which is the common case here).
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * Headline writer. No-op when quiet mode is off — operator runs
 * (DEBUG=machinen:*) want the legacy raw stream without a banner
 * on top.
 */
export function printHeadline(line: string): void {
  if (!isQuiet()) {
    return;
  }
  process.stderr.write(`${line}\n`);
}

export function formatElapsed(ms: number): string {
  if (ms < 0) {
    ms = 0;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

const ESCAPE_HINT = "run with DEBUG=machinen:* for live output\n";

interface DiagnosticsOpts {
  /** Suppressed boot/restore output. Skip when there's nothing to dump. */
  buffer?: RingBuffer | string;
  /**
   * Extra labeled tail blocks (e.g. `{ "restore.log": "...", "guest console": "..." }`).
   * Each renders under its own bracketed header inside the diagnostics envelope.
   */
  tails?: Record<string, string>;
  /**
   * Override the escape-hatch hint. Defaults to the standard
   * "run with DEBUG=…" line; pass an empty string to suppress.
   */
  hint?: string;
}

/**
 * Print the failure summary + diagnostics envelope. In operator
 * mode (DEBUG=machinen:*) the envelope is skipped — the user has
 * already seen the full live stream — but the summary line still
 * prints so the error is recognisable in the same place either way.
 */
export function printDiagnostics(summary: string, opts: DiagnosticsOpts = {}): void {
  process.stderr.write(`${summary}\n`);
  if (!isQuiet()) {
    return;
  }

  const bufStr = typeof opts.buffer === "string" ? opts.buffer : (opts.buffer?.toString() ?? "");
  const tails = opts.tails ?? {};
  const hasBuf = bufStr.trim().length > 0;
  const hasTails = Object.values(tails).some((t) => t && t.trim().length > 0);

  if (hasBuf || hasTails) {
    process.stderr.write("\n--- diagnostics ---\n");
    if (hasBuf) {
      process.stderr.write(bufStr);
      if (!bufStr.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    for (const [label, content] of Object.entries(tails)) {
      if (!content || content.trim().length === 0) {
        continue;
      }
      if (hasBuf) {
        process.stderr.write("\n");
      }
      process.stderr.write(`[${label}]\n`);
      process.stderr.write(content);
      if (!content.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    process.stderr.write("--------------------\n\n");
  }

  const hint = opts.hint ?? ESCAPE_HINT;
  if (hint.length > 0) {
    process.stderr.write(hint);
  }
}
