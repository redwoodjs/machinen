import type { LogEvent, VmHandle } from "@machinen/runtime";
import { PassThrough, Transform } from "node:stream";

import {
  formatElapsed,
  isQuiet,
  NoiseFilter,
  printDiagnostics,
  printHeadline,
  RingBuffer,
} from "./quiet.ts";

export interface QuietRunState {
  headlineName: string;
  showHeadlines: boolean;
  buffer: RingBuffer;
  filter: NoiseFilter | null;
  filterOut: PassThrough | null;
  onLog?: (evt: LogEvent) => void;
}

interface AttachedSessionOptions {
  filter: NoiseFilter | null;
  filterOut?: PassThrough | null;
  buffer: RingBuffer;
  preReadyExitSummary: (code: number) => string;
}

export async function runAttachedVmSession(
  vm: VmHandle,
  opts: AttachedSessionOptions,
): Promise<number> {
  vm.stdout.pipe(process.stdout);
  if (!opts.filter) {
    vm.stderr.pipe(process.stderr);
  }
  const restoreStdin = rawModeStdinIfTTY();
  const cancelHintRepeat = printCtrlDHint();
  const signalState = installVmSignalHandlers(vm);

  pipeStdinToVm(vm.stdin, () => {
    process.stderr.write("\nmachinen: Ctrl-D — stopping VM\n");
    signalState.forwardedSignal = "SIGTERM";
    void vm.kill();
  });
  opts.filterOut?.pipe(process.stderr);

  try {
    return await waitForAttachedVm(vm, opts, signalState);
  } finally {
    signalState.remove();
    cancelHintRepeat();
    restoreStdin();
  }
}

function rawModeStdinIfTTY(): () => void {
  const stdin = process.stdin;
  if (stdin.isTTY !== true) {
    return () => {};
  }
  const wasRaw = stdin.isRaw === true;
  stdin.setRawMode(true);
  return () => {
    if (!wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {}
    }
  };
}

function pipeStdinToVm(vmStdin: NodeJS.WritableStream, onCtrlD: () => void): void {
  const stdin = process.stdin;
  if (stdin.isTTY !== true) {
    stdin.pipe(vmStdin);
    return;
  }
  let fired = false;
  const intercept = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const idx = chunk.indexOf(0x04);
      if (idx === -1) {
        cb(null, chunk);
        return;
      }
      if (idx > 0) {
        this.push(chunk.subarray(0, idx));
      }
      cb();
      if (!fired) {
        fired = true;
        onCtrlD();
      }
    },
  });
  stdin.pipe(intercept).pipe(vmStdin);
}

function printCtrlDHint(repeatAfterMs = 3000): () => void {
  if (process.stdin.isTTY !== true) {
    return () => {};
  }
  const msg = "machinen: press Ctrl-D to stop\n";
  process.stderr.write(msg);
  if (isQuiet()) {
    return () => {};
  }
  const t = setTimeout(() => {
    process.stderr.write(msg);
  }, repeatAfterMs);
  t.unref();
  return () => clearTimeout(t);
}

type ForwardedSignal = "SIGINT" | "SIGTERM" | null;

interface VmSignalState {
  forwardedSignal: ForwardedSignal;
  remove: () => void;
}

function installVmSignalHandlers(vm: VmHandle): VmSignalState {
  const state: VmSignalState = { forwardedSignal: null, remove: () => {} };
  const onSigint = () => {
    state.forwardedSignal = "SIGINT";
    void vm.kill();
  };
  const onSigterm = () => {
    state.forwardedSignal = "SIGTERM";
    void vm.kill();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  state.remove = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
  return state;
}

async function waitForAttachedVm(
  vm: VmHandle,
  opts: AttachedSessionOptions,
  signalState: VmSignalState,
): Promise<number> {
  const { code } = await vm.wait();
  opts.filter?.flush();
  const signalExitCode = forwardedSignalExitCode(signalState.forwardedSignal);
  if (signalExitCode !== undefined) {
    return signalExitCode;
  }
  if (shouldPrintPreReadyDiagnostics(opts.filter, code, signalState.forwardedSignal)) {
    printDiagnostics(opts.preReadyExitSummary(code!), { buffer: opts.buffer });
  }
  return code ?? 0;
}

function forwardedSignalExitCode(signal: ForwardedSignal): number | undefined {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return undefined;
}

function shouldPrintPreReadyDiagnostics(
  filter: NoiseFilter | null,
  code: number | null,
  forwardedSignal: ForwardedSignal,
): boolean {
  if (!filter) {
    return false;
  }
  if (filter.ready || forwardedSignal) {
    return false;
  }
  return isNonZeroExit(code);
}

function isNonZeroExit(code: number | null): boolean {
  if (code === null) {
    return false;
  }
  return code !== 0;
}

export function bootBufferOnlyQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
): QuietRunState {
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter: null,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => buffer.push(chunk)),
  };
}

export function bootFilteredQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
  bootT0: number,
): QuietRunState {
  const filterOut = new PassThrough();
  const filter = new NoiseFilter({
    buffer,
    out: filterOut,
    onReady: () => {
      printHeadline("guest ready");
      printHeadline(`ready in ${formatElapsed(Date.now() - bootT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter,
    filterOut,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

export function guestConsoleOnLog(push: (chunk: Buffer) => void): (evt: LogEvent) => void {
  return (evt) => {
    if (evt.source === "guest-console") {
      push(evt.chunk);
    }
  };
}
