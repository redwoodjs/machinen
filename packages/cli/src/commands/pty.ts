import type { VmHandle } from "@machinen/runtime";

export async function runPtyExec(vm: VmHandle, cmd: string, sessionName?: string): Promise<number> {
  const tty = enterPtyRawMode();
  const handle = vm.execPty(cmd, {
    cols: tty.cols,
    rows: tty.rows,
    stdin: process.stdin,
    stdout: process.stdout,
    sessionName,
  });
  const onResize = () =>
    handle.resize(process.stdout.columns ?? tty.cols, process.stdout.rows ?? tty.rows);
  process.stdout.on("resize", onResize);
  try {
    const { exitCode } = await handle.result;
    return exitCode;
  } finally {
    process.stdout.removeListener("resize", onResize);
    tty.restore();
  }
}

function enterPtyRawMode(): { cols: number; rows: number; restore: () => void } {
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
    restore: () => restorePtyRawMode(wasRaw),
  };
}

function restorePtyRawMode(wasRaw: boolean): void {
  if (wasRaw) {
    return;
  }
  try {
    process.stdin.setRawMode(false);
  } catch {}
}
