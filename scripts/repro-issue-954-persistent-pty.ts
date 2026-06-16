import { Writable, PassThrough } from "node:stream";
import { attach } from "../packages/runtime/src/index.ts";

const vmName = process.env.MACHINEN_VM_NAME ?? "default";
const sessionName = process.env.MACHINEN_SESSION_NAME ?? "default";

class Capture extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function eventually(label: string, fn: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function log(step: string) {
  process.stderr.write(`[issue-954] ${step}\n`);
}

const vm = await attach({ name: vmName });
try {
  log(`attached to vm=${vmName}; resetting session=${sessionName}`);
  await vm.killSession?.(sessionName).catch(() => false);

  const stdin1 = new PassThrough();
  const stdout1 = new Capture();
  const first = vm.execPty("/bin/bash -i", {
    cols: 80,
    rows: 24,
    stdin: stdin1,
    stdout: stdout1,
    // Deliberately omitted: default session name should be "default".
  });

  log("started first PTY without sessionName; waiting for default session to appear");
  await eventually("default session to appear", async () => {
    const sessions = await vm.listSessions?.();
    return sessions?.some((s) => s.name === sessionName) ?? false;
  });

  log("sending command through first attach");
  stdin1.write("echo issue-954-first\n");
  await eventually("first output", async () => stdout1.text().includes("issue-954-first"));

  log("cancelling first attach to simulate host terminal/SSH disconnect");
  first.cancel();
  void first.result.catch(() => undefined);
  await sleep(250);

  const stdin2 = new PassThrough();
  const stdout2 = new Capture();
  const second = vm.execPty("/bin/bash -i", {
    cols: 80,
    rows: 24,
    stdin: stdin2,
    stdout: stdout2,
    // Deliberately omitted again: should reattach to default.
  });

  log("reattached without sessionName; sending second command");
  stdin2.write("echo issue-954-second\n");
  await eventually("reattached output", async () => stdout2.text().includes("issue-954-second"));

  log("exiting session and waiting for PTY result");
  stdin2.write("exit\n");
  const result = await second.result;
  if (result.exitCode !== 0) {
    throw new Error(`expected exitCode 0, got ${result.exitCode}`);
  }

  log("waiting for session to disappear from listSessions()");
  await eventually("default session to disappear", async () => {
    const sessions = await vm.listSessions?.();
    return !(sessions?.some((s) => s.name === sessionName) ?? false);
  });

  console.log(`issue-954 repro passed for vm=${vmName} session=${sessionName}`);
} finally {
  await vm.detach();
}
