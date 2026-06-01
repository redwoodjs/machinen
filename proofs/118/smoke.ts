#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Metadata = {
  cwd: string;
  env: Record<string, string>;
  stdio: string[];
  signals: Record<string, "default" | "ignored" | "custom">;
};
function translate(meta: Metadata): {
  accepted: boolean;
  targetStarted: boolean;
  targetMetadata?: Metadata;
  refusal?: { code: string };
} {
  if (!meta.cwd.startsWith("/app")) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-process-cwd-outside-root-refused" },
    };
  }
  if (Object.values(meta.signals).includes("custom")) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-custom-signal-handler-refused" },
    };
  }
  if (
    meta.stdio.length !== 3 ||
    !meta.stdio.every((entry) => entry === "pipe" || entry === "inherit")
  ) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-stdio-shape-unsupported" },
    };
  }
  if (Object.keys(meta.env).some((key) => key.startsWith("LD_PRELOAD"))) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-env-unsafe-key-refused" },
    };
  }
  return { accepted: true, targetStarted: false, targetMetadata: meta };
}
function main(): void {
  const meta: Metadata = {
    cwd: "/app/service",
    env: { NODE_ENV: "production", PORT: "3000" },
    stdio: ["pipe", "pipe", "inherit"],
    signals: { SIGPIPE: "ignored", SIGTERM: "default" },
  };
  const accepted = translate(meta);
  if (!accepted.accepted || !accepted.targetMetadata) {
    throw new Error(`metadata refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, Metadata, string]> = [
    ["bad-cwd", { ...meta, cwd: "/tmp" }, "node-proper-level5-process-cwd-outside-root-refused"],
    [
      "custom-signal",
      { ...meta, signals: { SIGUSR1: "custom" } },
      "node-proper-level5-custom-signal-handler-refused",
    ],
    [
      "bad-env",
      { ...meta, env: { LD_PRELOAD_HACK: "x" } },
      "node-proper-level5-env-unsafe-key-refused",
    ],
  ];
  const refusedRows = cases.map(([id, input, expectedCode]) => {
    const result = translate(input);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-process-metadata-summary",
    proof: "118",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      processMetadataCaptured: true,
      cwdEnvStdioSignalsTranslated: accepted.targetMetadata?.cwd === "/app/service",
      unsafeMetadataRefusesBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_118_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/118/checked-summary.json is stale; rerun with UPDATE_PROOF_118_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({ envKeys: Object.keys(meta.env).length, refused: refusedRows.length }),
  );
  console.log("proof 118 process metadata capture passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
