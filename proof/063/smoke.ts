#!/usr/bin/env tsx
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const key = "proof-063-private-proof-key";
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function sign(value: unknown): string {
  return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
}
function makeChain(): Record<string, unknown>[] {
  const capture = {
    stage: "capture",
    artifactDigest: digest({ heap: 2, arch: "arm64" }),
    previous: null,
  };
  const bundle = {
    stage: "bundle",
    artifactDigest: digest({ bundle: "translated", source: capture.artifactDigest }),
    previous: digest(capture),
  };
  const verifier = {
    stage: "verifier",
    artifactDigest: digest({ accepted: true, bundle: bundle.artifactDigest }),
    previous: digest(bundle),
  };
  const cli = {
    stage: "cli",
    artifactDigest: digest({ dryRunPlan: true, verifier: verifier.artifactDigest }),
    previous: digest(verifier),
  };
  return [capture, bundle, verifier, cli].map((entry) => ({ ...entry, signature: sign(entry) }));
}
function verifyChain(chain: Record<string, unknown>[]): { accepted: boolean; code: string } {
  let previous: string | null = null;
  for (const entry of chain) {
    const { signature, ...body } = entry;
    if (signature !== sign(body)) {
      return { accepted: false, code: "node-proper-level5-provenance-chain-signature-refused" };
    }
    if (body.previous !== previous) {
      return { accepted: false, code: "node-proper-level5-provenance-chain-link-refused" };
    }
    previous = digest(body);
  }
  return { accepted: true, code: "accepted" };
}
function main(): void {
  const chain = makeChain();
  const accepted = verifyChain(chain);
  if (!accepted.accepted) {
    throw new Error(`valid chain refused: ${JSON.stringify(accepted)}`);
  }
  const tampered = chain.map((entry) => ({ ...entry }));
  tampered[1].artifactDigest = "bad";
  const broken = chain.map((entry) => ({ ...entry }));
  broken[2].previous = "bad";
  {
    const { signature: _signature, ...body } = broken[2];
    broken[2].signature = sign(body);
  }
  const cases = [
    ["tampered-signature", tampered, "node-proper-level5-provenance-chain-signature-refused"],
    ["broken-link", broken, "node-proper-level5-provenance-chain-link-refused"],
  ] as const;
  const refusedRows = cases.map(([id, rowChain, expectedCode]) => {
    const result = verifyChain(rowChain);
    if (result.accepted || result.code !== expectedCode) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return { id, expectedCode, actualCode: result.code, targetStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-provenance-chain-digest-lock-summary",
    proof: "063",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    stages: chain.map((entry) => entry.stage),
    accepted,
    refusedRows,
    assertions: {
      captureToBundleToVerifierToCliLocked: true,
      tamperingRefuses: true,
      brokenLinksRefuse: true,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_063_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/063/checked-summary.json is stale; rerun with UPDATE_PROOF_063_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ stages: chain.length, refused: refusedRows.length }));
  console.log("proof 063 provenance chain digest lock passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
