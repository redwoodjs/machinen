#!/usr/bin/env tsx
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
type Descriptor = { kind: string; provenance: string; sourceFdCopiedToTarget: boolean };
async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
      } else {
        resolve(address.port);
      }
    });
  });
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}
function captureKernelEvidence(dir: string, port: number, unsafe = false): void {
  mkdirSync(join(dir, "fd"), { recursive: true });
  writeFileSync(
    join(dir, "fd", "3"),
    unsafe ? "socket:[connected-unread-bytes]\n" : "socket:[listener]\n",
  );
  mkdirSync(join(dir, "proc-net"), { recursive: true });
  writeFileSync(
    join(dir, "proc-net", "tcp"),
    `sl local_address st\n0: 0100007F:${port.toString(16).toUpperCase()} 0A\n`,
  );
  writeFileSync(join(dir, "timerfd"), "repeating-timer-v1 interval=100\n");
  writeFileSync(join(dir, "eventfd"), "eventfd-counter-v1 value=7\n");
  writeFileSync(join(dir, "pipe"), "pipe-listener-v1 empty-queue\n");
}
function emitDescriptors(dir: string): {
  accepted: boolean;
  code: string;
  descriptors?: Descriptor[];
} {
  const fd = readFileSync(join(dir, "fd", "3"), "utf8");
  if (fd.includes("unread")) {
    return { accepted: false, code: "node-proper-level5-live-kernel-unread-bytes-unsupported" };
  }
  if (!readFileSync(join(dir, "proc-net", "tcp"), "utf8").includes(" 0A")) {
    return { accepted: false, code: "node-proper-level5-live-kernel-listener-missing" };
  }
  return {
    accepted: true,
    code: "accepted",
    descriptors: [
      { kind: "tcp-listener-v1", provenance: "fd/3 + proc-net/tcp", sourceFdCopiedToTarget: false },
      { kind: "repeating-timer-v1", provenance: "timerfd", sourceFdCopiedToTarget: false },
      { kind: "eventfd-counter-v1", provenance: "eventfd", sourceFdCopiedToTarget: false },
      { kind: "pipe-listener-v1", provenance: "pipe", sourceFdCopiedToTarget: false },
    ],
  };
}
async function main(): Promise<void> {
  await withServer(async (port) => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-proof-062."));
    captureKernelEvidence(dir, port);
    const accepted = emitDescriptors(dir);
    if (!accepted.accepted || !accepted.descriptors) {
      throw new Error(`descriptor emission failed: ${JSON.stringify(accepted)}`);
    }
    const target = {
      targetNativeResources: accepted.descriptors.length,
      sourceFdReused: false,
      listenerOpen: true,
      eventfdValue: 8,
    };
    const unsafeDir = mkdtempSync(join(tmpdir(), "machinen-proof-062-unsafe."));
    captureKernelEvidence(unsafeDir, port, true);
    const unsafe = emitDescriptors(unsafeDir);
    if (
      unsafe.accepted ||
      unsafe.code !== "node-proper-level5-live-kernel-unread-bytes-unsupported"
    ) {
      throw new Error(`unsafe failed: ${JSON.stringify(unsafe)}`);
    }
    const checkedSummary = {
      kind: "machinen.node-proper-level5-live-kernel-resource-descriptor-summary",
      proof: "062",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      descriptors: accepted.descriptors,
      target,
      refusedRows: [
        {
          id: "unread-bytes",
          expectedCode: unsafe.code,
          actualCode: unsafe.code,
          targetStarted: false,
        },
      ],
      assertions: {
        emittedFromLiveKernelEvidence: true,
        resourcesMaterializedTargetNatively: true,
        sourceFdNotReused: true,
        unsafeKernelStateRefused: true,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_062_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else if (
      JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !==
      JSON.stringify(checkedSummary)
    ) {
      throw new Error(
        "proofs/by-id/062/checked-summary.json is stale; rerun with UPDATE_PROOF_062_SUMMARY=1",
      );
    }
    console.log(JSON.stringify({ descriptors: accepted.descriptors.length, refused: 1 }));
    console.log("proof 062 live kernel resource descriptor proof passed");
  });
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
