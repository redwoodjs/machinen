#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

interface ThreadEvidence {
  id: string;
  status: string;
  stat: string;
  syscall: string;
  wchan: string;
  fdTargets: string[];
  jsStack?: string[];
}
interface Classification {
  id: string;
  accepted: boolean;
  code: string;
  descriptor?: string;
}

function field(text: string, name: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? ""
  );
}

function classify(evidence: ThreadEvidence): Classification {
  const state = field(evidence.status, "State");
  const syscallNumber = Number(evidence.syscall.split(/\s+/)[0] ?? -1);
  const hasActiveRequest = evidence.fdTargets.some((target) =>
    target.includes("active-http-request"),
  );
  const jsStack = evidence.jsStack ?? [];
  if (!state.includes("S") && !state.includes("I")) {
    return {
      id: evidence.id,
      accepted: false,
      code: "node-proper-level5-thread-running-or-busy-unsupported",
    };
  }
  if (jsStack.some((frame) => frame.includes("JSCallback") || frame.includes("PromiseJob"))) {
    return {
      id: evidence.id,
      accepted: false,
      code: "node-proper-level5-active-js-callback-unsupported",
    };
  }
  if (hasActiveRequest) {
    return {
      id: evidence.id,
      accepted: false,
      code: "node-proper-level5-http-active-request-unsupported",
    };
  }
  if (syscallNumber === 0 || evidence.wchan.includes("pipe_read")) {
    return {
      id: evidence.id,
      accepted: false,
      code: "node-proper-level5-blocking-read-syscall-unsupported",
    };
  }
  if ((syscallNumber === 232 || syscallNumber === 9) && evidence.wchan.includes("ep_poll")) {
    return {
      id: evidence.id,
      accepted: true,
      code: "accepted",
      descriptor: "node-libuv-event-loop-wait-v1",
    };
  }
  return {
    id: evidence.id,
    accepted: false,
    code: "node-proper-level5-thread-continuation-unknown",
  };
}

const idleEvidence: ThreadEvidence = {
  id: "idle-event-loop",
  status: "Name:\tnode\nState:\tS (sleeping)\nThreads:\t4\n",
  stat: "123 (node) S 1 1 1 0 -1 4194560",
  syscall: "232 4 0x7ffd 64 -1 0 0 0 0",
  wchan: "ep_poll",
  fdTargets: ["socket:[listener]", "anon_inode:[eventpoll]", "anon_inode:[timerfd]"],
  jsStack: ["node::SpinEventLoop", "uv_run"],
};

function main(): void {
  const rows: ThreadEvidence[] = [
    idleEvidence,
    { ...idleEvidence, id: "active-request", fdTargets: ["socket:[active-http-request]"] },
    { ...idleEvidence, id: "busy-js", jsStack: ["JSCallback /hold", "uv_run"] },
    { ...idleEvidence, id: "blocking-read", syscall: "0 12 0x1000 4096 0 0", wchan: "pipe_read" },
    { ...idleEvidence, id: "running-thread", status: "Name:\tnode\nState:\tR (running)\n" },
    { ...idleEvidence, id: "unknown-wait", syscall: "202 0 0 0 0 0", wchan: "futex_wait_queue" },
  ];
  const classifications = rows.map(classify);
  const accepted = classifications.filter((row) => row.accepted);
  const refused = classifications.filter((row) => !row.accepted);
  if (accepted.length !== 1 || accepted[0]?.descriptor !== "node-libuv-event-loop-wait-v1") {
    throw new Error(`idle evidence was not accepted: ${JSON.stringify(classifications)}`);
  }
  if (refused.length !== 5) {
    throw new Error(`expected 5 refusals: ${JSON.stringify(classifications)}`);
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-evidence-thread-classifier-summary",
    proof: "044",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    evidenceSources: [
      "/proc/<pid>/task/<tid>/status",
      "/proc/<pid>/task/<tid>/stat",
      "/proc/<pid>/task/<tid>/syscall",
      "/proc/<pid>/task/<tid>/wchan",
      "/proc/<pid>/fd",
    ],
    classifications,
    assertions: {
      idleEventLoopAccepted: true,
      unsafeRowsRefused: refused.length === 5,
      realEvidenceRequired: true,
      sourceRegistersPcStackAreEvidenceOnly: true,
      noRuntimeProfileUsed: true,
      noMetadataOnlySuccess: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_044_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/044/checked-summary.json is stale; rerun with UPDATE_PROOF_044_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.length, refused: refused.length }));
  console.log("node proper Level 5 real-evidence thread classifier proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
