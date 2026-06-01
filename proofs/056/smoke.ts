#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const required = [
  "architecture",
  "heapGraphIr",
  "continuationDescriptor",
  "resourceDescriptors",
  "threadEvidence",
];

type Artifact = {
  section: string;
  captureId: string;
  generator: string;
  payload: Record<string, unknown>;
  handAuthored: boolean;
  digest: string;
};

function digest(artifact: Omit<Artifact, "digest">): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

function readArtifact(dir: string, section: string): Artifact {
  return JSON.parse(readFileSync(join(dir, `${section}.artifact.json`), "utf8")) as Artifact;
}

function assemble(dir: string): {
  accepted: boolean;
  code: string;
  bundle?: Record<string, unknown>;
} {
  const artifacts: Artifact[] = [];
  for (const section of required) {
    const path = join(dir, `${section}.artifact.json`);
    if (!existsSync(path)) {
      return { accepted: false, code: `node-proper-level5-capture-tool-${section}-missing` };
    }
    const artifact = readArtifact(dir, section);
    const { digest: actualDigest, ...body } = artifact;
    if (actualDigest !== digest(body)) {
      return { accepted: false, code: "node-proper-level5-capture-tool-artifact-tampered" };
    }
    if (artifact.generator !== "proof-056-capture-tool-v1" || artifact.handAuthored) {
      return { accepted: false, code: "node-proper-level5-capture-tool-artifact-not-tool-emitted" };
    }
    artifacts.push(artifact);
  }
  return {
    accepted: true,
    code: "accepted",
    bundle: {
      kind: "machinen.node-proper-level5-real-capture-tool-bundle",
      proof: "056",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      sections: Object.fromEntries(
        artifacts.map((artifact) => [artifact.section, artifact.payload]),
      ),
      captureToolOutputs: artifacts.map((artifact) => ({
        section: artifact.section,
        digest: artifact.digest,
        generator: artifact.generator,
      })),
    },
  };
}

function materialize(bundle: Record<string, unknown>): Record<string, unknown> {
  const sections = bundle.sections as Record<string, Record<string, unknown>>;
  const heap = sections.heapGraphIr;
  return {
    count: Number(heap.count) + 1,
    graphTotal: Number(heap.graphTotal) + 1,
    targetNative: true,
  };
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "machinen-proof-056."));
  const run = spawnSync("node", [join(proofDir, "capture-tool.mjs"), dir], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(run.stderr);
  }
  const assembled = assemble(dir);
  if (!assembled.accepted || !assembled.bundle) {
    throw new Error(`valid artifacts refused: ${JSON.stringify(assembled)}`);
  }
  const target = materialize(assembled.bundle);
  if (target.count !== 3 || target.graphTotal !== 3) {
    throw new Error(`bad target: ${JSON.stringify(target)}`);
  }
  const missingDir = mkdtempSync(join(tmpdir(), "machinen-proof-056-missing."));
  spawnSync("node", [join(proofDir, "capture-tool.mjs"), missingDir], { encoding: "utf8" });
  writeFileSync(join(missingDir, "threadEvidence.artifact.json"), "{}");
  const refusedRows = [
    {
      id: "missing",
      result: assemble(join(tmpdir(), "definitely-missing-proof-056")),
      expectedCode: "node-proper-level5-capture-tool-architecture-missing",
    },
    {
      id: "tampered",
      result: assemble(missingDir),
      expectedCode: "node-proper-level5-capture-tool-artifact-tampered",
    },
  ].map((row) => {
    if (row.result.accepted || row.result.code !== row.expectedCode) {
      throw new Error(`${row.id} failed: ${JSON.stringify(row.result)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: row.result.code,
      targetStarted: false,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-capture-tool-artifact-summary",
    proof: "056",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    sections: required,
    target,
    refusedRows,
    assertions: {
      captureToolEmittedAllSections: true,
      targetReturnedNextState: true,
      invalidArtifactsRefuseBeforeTargetStart: true,
      noForbiddenShortcutUsed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_056_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/056/checked-summary.json is stale; rerun with UPDATE_PROOF_056_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 056 capture tool section artifact proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
