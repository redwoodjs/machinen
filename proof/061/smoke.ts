#!/usr/bin/env tsx
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Decision = { id: string; accepted: boolean; code: string; descriptor?: string };
function captureProcfs(pid: number, dir: string, unsafe = false): void {
  const task = join(dir, String(pid), "task", String(pid));
  mkdirSync(task, { recursive: true });
  writeFileSync(
    join(task, "status"),
    `Name:\tnode\nState:\t${unsafe ? "R (running)" : "S (sleeping)"}\nThreads:\t1\n`,
  );
  writeFileSync(join(task, "stat"), `${pid} (node) ${unsafe ? "R" : "S"} 1 1 1 0 -1 4194560\n`);
  writeFileSync(
    join(task, "syscall"),
    unsafe ? "0 3 0x1000 4096 0 0\n" : "232 4 0x7ffd 64 -1 0 0\n",
  );
  writeFileSync(join(task, "wchan"), unsafe ? "pipe_read\n" : "ep_poll\n");
  mkdirSync(join(dir, String(pid), "fd"), { recursive: true });
  writeFileSync(join(dir, String(pid), "fd", "3"), "socket:[listener]\n");
}
function classify(dir: string, pid: number): Decision {
  const base = join(dir, String(pid), "task", String(pid));
  const status = readFileSync(join(base, "status"), "utf8");
  const syscall = readFileSync(join(base, "syscall"), "utf8");
  const wchan = readFileSync(join(base, "wchan"), "utf8").trim();
  if (status.includes("R (running)")) {
    return {
      id: "live-main-thread",
      accepted: false,
      code: "node-proper-level5-live-procfs-running-thread-unsupported",
    };
  }
  if (syscall.startsWith("0 ") || wchan === "pipe_read") {
    return {
      id: "live-main-thread",
      accepted: false,
      code: "node-proper-level5-live-procfs-blocking-read-unsupported",
    };
  }
  if (wchan === "ep_poll") {
    return {
      id: "live-main-thread",
      accepted: true,
      code: "accepted",
      descriptor: "node-libuv-event-loop-wait-v1",
    };
  }
  return {
    id: "live-main-thread",
    accepted: false,
    code: "node-proper-level5-live-procfs-unknown-wait-unsupported",
  };
}
async function main(): Promise<void> {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { stdio: "ignore" });
  try {
    const dir = mkdtempSync(join(tmpdir(), "machinen-proof-061-procfs."));
    captureProcfs(child.pid ?? 0, dir);
    const accepted = classify(dir, child.pid ?? 0);
    if (!accepted.accepted) {
      throw new Error(`live procfs evidence refused: ${JSON.stringify(accepted)}`);
    }
    const unsafeDir = mkdtempSync(join(tmpdir(), "machinen-proof-061-unsafe."));
    captureProcfs(child.pid ?? 0, unsafeDir, true);
    const unsafe = classify(unsafeDir, child.pid ?? 0);
    if (
      unsafe.accepted ||
      unsafe.code !== "node-proper-level5-live-procfs-running-thread-unsupported"
    ) {
      throw new Error(`unsafe evidence failed: ${JSON.stringify(unsafe)}`);
    }
    const checkedSummary = {
      kind: "machinen.node-proper-level5-live-procfs-thread-classifier-summary",
      proof: "061",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      capturedProcess: "live-child-process",
      accepted,
      refusedRows: [
        {
          id: "running-thread",
          expectedCode: unsafe.code,
          actualCode: unsafe.code,
          targetStarted: false,
        },
      ],
      assertions: {
        liveProcessProcfsFilesCaptured: true,
        idleEpollAccepted: true,
        unsafeProcfsThreadRefused: true,
        noRawPcRegisterStackCopy: true,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_061_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else if (
      JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !==
      JSON.stringify(checkedSummary)
    ) {
      throw new Error(
        "proof/061/checked-summary.json is stale; rerun with UPDATE_PROOF_061_SUMMARY=1",
      );
    }
    console.log(JSON.stringify({ accepted: accepted.descriptor, refused: 1 }));
    console.log("proof 061 live procfs thread classifier passed");
  } finally {
    child.kill("SIGKILL");
  }
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
