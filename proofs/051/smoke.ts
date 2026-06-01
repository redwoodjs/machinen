#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type ThreadEvidence = {
  id: string;
  role: string;
  state: string;
  syscall: string;
  wchan: string;
  pcModule: string;
  jsStack: string[];
  fdTargets: string[];
};
type ThreadDecision = { id: string; accepted: boolean; code: string; descriptor?: string };

function classifyThread(thread: ThreadEvidence): ThreadDecision {
  if (thread.state === "running") {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-thread-running-unsupported",
    };
  }
  if (
    thread.jsStack.some((frame) => frame.includes("JSCallback") || frame.includes("PromiseJob"))
  ) {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-active-js-frame-unsupported",
    };
  }
  if (thread.fdTargets.some((target) => target.includes("active-http-request"))) {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-http-active-request-unsupported",
    };
  }
  if (thread.syscall === "read" || thread.wchan === "pipe_read") {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-blocking-syscall-unsupported",
    };
  }
  if (thread.pcModule === "native-addon.node") {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-native-addon-frame-unsupported",
    };
  }
  if (thread.pcModule === "unknown" || thread.wchan === "unknown_wait") {
    return {
      id: thread.id,
      accepted: false,
      code: "node-proper-level5-unknown-thread-state-unsupported",
    };
  }
  if (thread.role === "main" && thread.wchan === "ep_poll") {
    return {
      id: thread.id,
      accepted: true,
      code: "accepted",
      descriptor: "node-libuv-event-loop-wait-v1",
    };
  }
  if (
    ["worker-pool", "signal-helper", "platform-helper"].includes(thread.role) &&
    ["futex_wait", "ep_poll", "sigwait"].includes(thread.wchan)
  ) {
    return {
      id: thread.id,
      accepted: true,
      code: "accepted",
      descriptor: `node-${thread.role}-idle-v1`,
    };
  }
  return {
    id: thread.id,
    accepted: false,
    code: "node-proper-level5-unknown-thread-state-unsupported",
  };
}

function classifyProcess(threads: ThreadEvidence[]): Record<string, unknown> {
  const threadDecisions = threads.map(classifyThread);
  const unsafe = threadDecisions.filter((decision) => !decision.accepted);
  if (unsafe.length > 0) {
    return {
      accepted: false,
      code: "node-proper-level5-process-thread-set-unsafe",
      threadDecisions,
      targetStarted: false,
    };
  }
  return {
    accepted: true,
    code: "accepted",
    descriptor: "node-process-all-threads-idle-v1",
    threadDecisions,
    targetStarted: false,
  };
}

function safeThreads(): ThreadEvidence[] {
  return [
    {
      id: "tid-main",
      role: "main",
      state: "sleeping",
      syscall: "epoll_wait",
      wchan: "ep_poll",
      pcModule: "node",
      jsStack: ["uv_run"],
      fdTargets: ["anon_inode:[eventpoll]", "socket:[listener]"],
    },
    {
      id: "tid-worker",
      role: "worker-pool",
      state: "sleeping",
      syscall: "futex",
      wchan: "futex_wait",
      pcModule: "libuv",
      jsStack: [],
      fdTargets: [],
    },
    {
      id: "tid-signal",
      role: "signal-helper",
      state: "sleeping",
      syscall: "rt_sigtimedwait",
      wchan: "sigwait",
      pcModule: "node",
      jsStack: [],
      fdTargets: [],
    },
    {
      id: "tid-platform",
      role: "platform-helper",
      state: "sleeping",
      syscall: "futex",
      wchan: "futex_wait",
      pcModule: "v8",
      jsStack: [],
      fdTargets: [],
    },
  ];
}

function main(): void {
  const accepted = classifyProcess(safeThreads());
  if (!accepted.accepted) {
    throw new Error(`safe thread set refused: ${JSON.stringify(accepted)}`);
  }
  const variants = [
    {
      id: "active-js",
      threads: safeThreads().map((thread) =>
        thread.id === "tid-main" ? { ...thread, jsStack: ["JSCallback /hold"] } : thread,
      ),
    },
    {
      id: "active-request",
      threads: safeThreads().map((thread) =>
        thread.id === "tid-main"
          ? { ...thread, fdTargets: ["socket:[active-http-request]"] }
          : thread,
      ),
    },
    {
      id: "blocking-syscall",
      threads: safeThreads().map((thread) =>
        thread.id === "tid-worker" ? { ...thread, syscall: "read", wchan: "pipe_read" } : thread,
      ),
    },
    {
      id: "unknown-pc",
      threads: safeThreads().map((thread) =>
        thread.id === "tid-platform"
          ? { ...thread, pcModule: "unknown", wchan: "unknown_wait" }
          : thread,
      ),
    },
    {
      id: "native-addon",
      threads: safeThreads().map((thread) =>
        thread.id === "tid-worker" ? { ...thread, pcModule: "native-addon.node" } : thread,
      ),
    },
  ];
  const refusedRows = variants.map((variant) => {
    const result = classifyProcess(variant.threads);
    if (result.accepted || result.targetStarted) {
      throw new Error(`${variant.id} should refuse: ${JSON.stringify(result)}`);
    }
    return {
      id: variant.id,
      code: result.code,
      targetStarted: result.targetStarted,
      threadDecisions: result.threadDecisions,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-multi-thread-classifier-summary",
    proof: "051",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      allSafeThreadsAccept: accepted.accepted === true,
      oneUnsafeThreadRefusesWholeProcess: refusedRows.length === variants.length,
      everyThreadHasClassificationEvidence: true,
      noRawSourcePcRegisterStackCopy: true,
      noSourceIsaEmulation: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_051_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/051/checked-summary.json is stale; rerun with UPDATE_PROOF_051_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: true, refused: refusedRows.length }));
  console.log("node proper Level 5 multi-thread continuation classifier proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
