// Multiplexing many concurrent VMs across one host terminal (#51 M1).
//
// Shape:
//   1. `Sandboxes` is a registry. You `add(id, vm)` each VmHandle you
//      spawn; you can `list()` them, `send(id, bytes)` to their
//      stdin, and `onOutput(id, fn)` to observe their stderr/stdout.
//      Each entry has a small scrollback ring so a late attach shows
//      what the sandbox has been saying recently.
//
//   2. `Supervisor` drives the interactive UX on top of that registry.
//      It owns `process.stdin`/`process.stdout`. Typing `/ls` lists
//      sandboxes, `/attach <id>` forwards your keystrokes to that
//      sandbox and streams its output back. `Ctrl-] Ctrl-]` during an
//      attached session returns to the supervisor prompt.
//
// PTY niceties (colors under attach, TIOCSWINSZ on resize) are the
// obvious next step; this is the pipe-based M1.

import type { Writable } from "node:stream";
import type { VmHandle } from "./index.ts";

export interface SandboxEntry {
  id: string;
  vm: VmHandle;
  scrollback: Buffer;
  readonly addedAt: number;
}

export interface OnOutputListener {
  (chunk: Buffer, source: "stdout" | "stderr"): void;
}

/**
 * Registry of live sandboxes. Thread-safe in the sense that there's
 * only one runtime thread anyway; the class just bookkeeps handles +
 * their scrollback rings so the supervisor doesn't need to.
 */
export class Sandboxes {
  private readonly items = new Map<string, SandboxEntry>();
  private readonly subs = new Map<string, Set<OnOutputListener>>();

  /**
   * Maximum bytes retained per sandbox for replay on attach. The ring
   * keeps only the most recent chunk up to this limit — a reasonable
   * trade between "see enough context to know what's going on" and
   * "don't leak memory if the sandbox runs for hours."
   */
  readonly scrollbackBytes: number;

  constructor(opts: { scrollbackBytes?: number } = {}) {
    this.scrollbackBytes = opts.scrollbackBytes ?? 8 * 1024;
  }

  add(id: string, vm: VmHandle): void {
    if (this.items.has(id)) {
      throw new Error(`sandbox id already registered: ${id}`);
    }
    const entry: SandboxEntry = {
      id,
      vm,
      scrollback: Buffer.alloc(0),
      addedAt: Date.now(),
    };
    this.items.set(id, entry);

    const onStdout = (c: Buffer) => this.record(entry, c, "stdout");
    const onStderr = (c: Buffer) => this.record(entry, c, "stderr");
    vm.stdout.on("data", onStdout);
    vm.stderr.on("data", onStderr);
    // Best-effort cleanup: when the VM exits, drop the entry.
    void vm
      .wait()
      .then(() => this.remove(id))
      .catch(() => this.remove(id));
  }

  /** Remove a sandbox. Does not kill the VM — call `vm.kill()` first. */
  remove(id: string): void {
    this.items.delete(id);
    this.subs.delete(id);
  }

  list(): Array<{ id: string; addedAt: number }> {
    return Array.from(this.items.values()).map((e) => ({
      id: e.id,
      addedAt: e.addedAt,
    }));
  }

  get(id: string): SandboxEntry | undefined {
    return this.items.get(id);
  }

  /** Write `data` to the sandbox's stdin. No-op if the id is unknown. */
  send(id: string, data: string | Buffer): boolean {
    const e = this.items.get(id);
    if (!e) return false;
    e.vm.stdin.write(data);
    return true;
  }

  /**
   * Subscribe to `id`'s output. Returns an unsubscribe function. The
   * listener fires only for NEW bytes produced after the subscription
   * — use `get(id).scrollback` to replay history if you want it.
   */
  onOutput(id: string, fn: OnOutputListener): () => void {
    let set = this.subs.get(id);
    if (!set) {
      set = new Set();
      this.subs.set(id, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }

  private record(entry: SandboxEntry, chunk: Buffer, source: "stdout" | "stderr"): void {
    const combined = Buffer.concat([entry.scrollback, chunk]);
    entry.scrollback =
      combined.length <= this.scrollbackBytes
        ? combined
        : combined.subarray(combined.length - this.scrollbackBytes);
    const subs = this.subs.get(entry.id);
    if (subs) for (const fn of subs) fn(chunk, source);
  }
}

// ---------------------------------------------------------------------
// Interactive supervisor

export interface SupervisorOptions {
  /** Registry to draw sandboxes from. */
  sandboxes: Sandboxes;
  /** Input byte stream. Defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream;
  /** Output byte stream. Defaults to `process.stdout`. */
  output?: Writable;
  /** Prefix for slash-commands. Default `/`. */
  commandPrefix?: string;
  /**
   * Flip the terminal into raw mode while a sandbox is attached, and
   * restore it on detach. Enabled by default when `input` is a TTY.
   * Set to `false` in tests where `input` is a plain PassThrough.
   */
  rawTtyOnAttach?: boolean;
  /**
   * Forward SIGWINCH on the parent process (terminal resize) to any
   * attached sandbox that implements `.resize(cols, rows)`. Enabled
   * by default when `output` is a TTY.
   */
  forwardResize?: boolean;
}

/**
 * A minimal text-driven multiplexer. Runs until `.stop()` is called
 * or the input stream ends.
 *
 * Command surface when detached (lines prefixed with `/`):
 *   /ls              — list sandboxes and their state
 *   /attach <id>     — forward to/from the given sandbox
 *   /help            — show commands
 *   /quit            — stop the supervisor (does not kill sandboxes)
 *
 * When attached, bytes are piped verbatim to the sandbox's stdin.
 * Hit `Ctrl-] Ctrl-]` (two 0x1D bytes in a row) to detach.
 */
export class Supervisor {
  readonly sandboxes: Sandboxes;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: Writable;
  private readonly prefix: string;
  private readonly rawTtyOnAttach: boolean;
  private readonly forwardResize: boolean;

  private attachedId: string | null = null;
  private attachedUnsub: (() => void) | null = null;
  private lastGs: boolean = false; // tracks consecutive Ctrl-] for detach
  private stopped = false;
  private onEnd: (() => void) | null = null;
  private priorRawState: boolean | null = null;
  private winchHandler: (() => void) | null = null;

  constructor(opts: SupervisorOptions) {
    this.sandboxes = opts.sandboxes;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.prefix = opts.commandPrefix ?? "/";
    // Raw mode: on if explicitly requested, off if explicitly refused,
    // else on when the input is an actual TTY.
    const inIsTty = (this.input as NodeJS.ReadStream).isTTY === true;
    const outIsTty = (this.output as NodeJS.WriteStream).isTTY === true;
    this.rawTtyOnAttach = opts.rawTtyOnAttach ?? inIsTty;
    this.forwardResize = opts.forwardResize ?? outIsTty;
  }

  /** Run until stopped. Resolves when input ends or stop() is called. */
  run(): Promise<void> {
    this.print(this.bannerText());
    return new Promise<void>((done) => {
      const onData = (chunk: Buffer) => this.ingest(chunk);
      const onEnd = () => {
        this.detach();
        this.input.off("data", onData);
        this.input.off("end", onEnd);
        done();
      };
      this.onEnd = onEnd;
      this.input.on("data", onData);
      this.input.on("end", onEnd);
    });
  }

  /** Programmatic stop (e.g. from a test). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.detach();
    this.onEnd?.();
  }

  /** Attach to `id`. Throws if id doesn't exist. */
  attach(id: string): void {
    this.detach();
    const entry = this.sandboxes.get(id);
    if (!entry) throw new Error(`unknown sandboxes id: ${id}`);
    this.attachedId = id;
    // Replay scrollback so the user sees recent output.
    if (entry.scrollback.length > 0) this.output.write(entry.scrollback);
    this.attachedUnsub = this.sandboxes.onOutput(id, (chunk) => {
      this.output.write(chunk);
    });

    // Terminal handoff. Put host stdin into raw mode so every keystroke
    // reaches the sandbox without the shell's line buffering eating it;
    // hook SIGWINCH so a resize reshapes the sandbox's pty if it
    // supports resize.
    if (this.rawTtyOnAttach) this.enterRawTty();
    if (this.forwardResize) this.installWinchHandler(entry);

    this.print(`\n-- attached to ${id} (Ctrl-] Ctrl-] to detach) --\n`);
  }

  detach(): void {
    if (!this.attachedId) return;
    this.attachedUnsub?.();
    this.attachedUnsub = null;
    const prev = this.attachedId;
    this.attachedId = null;
    this.lastGs = false;
    this.removeWinchHandler();
    this.leaveRawTty();
    this.print(`\n-- detached from ${prev} --\n`);
  }

  private enterRawTty(): void {
    const stream = this.input as NodeJS.ReadStream;
    if (!stream.isTTY || typeof stream.setRawMode !== "function") return;
    this.priorRawState = stream.isRaw ?? false;
    stream.setRawMode(true);
  }

  private leaveRawTty(): void {
    const stream = this.input as NodeJS.ReadStream;
    if (!stream.isTTY || typeof stream.setRawMode !== "function") return;
    if (this.priorRawState !== null) {
      stream.setRawMode(this.priorRawState);
      this.priorRawState = null;
    }
  }

  private installWinchHandler(entry: SandboxEntry): void {
    const resize = (entry.vm as { resize?: (cols: number, rows: number) => void }).resize;
    if (typeof resize !== "function") return;
    const outStream = this.output as NodeJS.WriteStream;
    const push = () => {
      const cols = outStream.columns ?? 80;
      const rows = outStream.rows ?? 24;
      try {
        resize.call(entry.vm, cols, rows);
      } catch {
        /* best-effort — the vm may already be gone */
      }
    };
    // Set the current size immediately so the sandbox sees a correct
    // TIOCGWINSZ the first time it asks.
    push();
    this.winchHandler = push;
    process.on("SIGWINCH", push);
  }

  private removeWinchHandler(): void {
    if (this.winchHandler) {
      process.off("SIGWINCH", this.winchHandler);
      this.winchHandler = null;
    }
  }

  private ingest(chunk: Buffer): void {
    if (this.attachedId) {
      // Scan for the double-Ctrl-] detach sequence and forward the
      // rest to the attached sandbox.
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]!;
        if (b === 0x1d /* Ctrl-] */) {
          if (this.lastGs) {
            // Second in a row — detach, drop the two bytes, keep the
            // tail for the next command.
            const toSend = chunk.subarray(start, i - 1);
            if (toSend.length > 0) this.sandboxes.send(this.attachedId, toSend);
            this.detach();
            const remainder = chunk.subarray(i + 1);
            if (remainder.length > 0) this.ingest(remainder);
            return;
          }
          this.lastGs = true;
        } else {
          this.lastGs = false;
        }
      }
      this.sandboxes.send(this.attachedId, chunk.subarray(start));
      return;
    }

    // Detached: buffer lines and parse them as commands.
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      this.handleCommand(line);
    }
  }

  private handleCommand(raw: string): void {
    const line = raw.trim();
    if (!line.startsWith(this.prefix)) {
      this.print(`(unknown input; commands start with '${this.prefix}'. try /help)\n`);
      return;
    }
    const [cmd, ...rest] = line.slice(this.prefix.length).split(/\s+/);
    switch (cmd) {
      case "ls":
        this.doLs();
        return;
      case "attach":
        if (rest[0]) this.attach(rest[0]);
        else this.print(`usage: /attach <id>\n`);
        return;
      case "help":
        this.print(this.bannerText());
        return;
      case "quit":
      case "exit":
        this.stop();
        return;
      default:
        this.print(`unknown command: ${cmd}\n`);
    }
  }

  private doLs(): void {
    const rows = this.sandboxes.list();
    if (rows.length === 0) {
      this.print("(no sandboxes registered)\n");
      return;
    }
    for (const r of rows) this.print(`  ${r.id}\n`);
  }

  private bannerText(): string {
    return (
      `machinen supervisor — commands start with '${this.prefix}'\n` +
      `  /ls           list sandboxes\n` +
      `  /attach <id>  forward terminal to/from a sandbox (Ctrl-] Ctrl-] to detach)\n` +
      `  /quit         stop the supervisor\n` +
      `  /help         show this message\n`
    );
  }

  private print(msg: string): void {
    this.output.write(msg);
  }
}
