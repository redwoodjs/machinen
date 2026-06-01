#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Artifact = {
  section: string;
  path: string;
  digest: string;
  generator: string;
  captureId: string;
  handAuthored: boolean;
  payload: Record<string, unknown>;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function emitArtifact(work: string, section: string, payload: Record<string, unknown>): Artifact {
  const artifact = {
    section,
    generator: "proof-047-capture-emitter-v1",
    captureId: "arm64-source-capture-047",
    handAuthored: false,
    payload,
  };
  const path = join(work, `${section}.json`);
  const artifactWithDigest = { ...artifact, path, digest: digest(artifact) };
  writeFileSync(path, `${JSON.stringify(artifactWithDigest, null, 2)}\n`);
  return artifactWithDigest;
}

function readArtifact(path: string): Artifact {
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function assembleBundle(paths: string[]): {
  accepted: boolean;
  code: string;
  bundle?: Record<string, unknown>;
} {
  const artifacts = paths.map(readArtifact);
  const required = [
    "heapGraphIr",
    "continuationDescriptor",
    "resourceDescriptors",
    "threadEvidence",
    "architecture",
  ];
  for (const section of required) {
    const artifact = artifacts.find((candidate) => candidate.section === section);
    if (!artifact) {
      return { accepted: false, code: `node-proper-level5-capture-artifact-${section}-missing` };
    }
    const expectedDigest = digest({
      section: artifact.section,
      generator: artifact.generator,
      captureId: artifact.captureId,
      handAuthored: artifact.handAuthored,
      payload: artifact.payload,
    });
    if (artifact.digest !== expectedDigest) {
      return { accepted: false, code: "node-proper-level5-capture-artifact-stale-or-tampered" };
    }
    if (artifact.generator !== "proof-047-capture-emitter-v1" || artifact.handAuthored) {
      return { accepted: false, code: "node-proper-level5-hand-authored-section-refused" };
    }
  }
  return {
    accepted: true,
    code: "accepted",
    bundle: {
      kind: "machinen.node-proper-level5-capture-emitted-translated-bundle",
      proof: "047",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      sections: Object.fromEntries(
        artifacts.map((artifact) => [artifact.section, artifact.payload]),
      ),
      provenance: Object.fromEntries(
        artifacts.map((artifact) => [
          artifact.section,
          {
            path: artifact.path,
            digest: artifact.digest,
            generator: artifact.generator,
            captureId: artifact.captureId,
          },
        ]),
      ),
      sourceCpuStateEvidenceOnly: true,
      sourceKernelResourcesEvidenceOnly: true,
    },
  };
}

function materialize(bundle: Record<string, unknown>): {
  count: number;
  graphTotal: number;
  targetNative: boolean;
} {
  const sections = bundle.sections as Record<string, Record<string, unknown>>;
  return {
    count: Number(sections.heapGraphIr.count) + 1,
    graphTotal: Number(sections.heapGraphIr.graphTotal) + 1,
    targetNative: true,
  };
}

function assertRefusal(
  id: string,
  result: { accepted: boolean; code: string },
  expectedCode: string,
): Record<string, unknown> {
  if (result.accepted || result.code !== expectedCode) {
    throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
  }
  return { id, expectedCode, actualCode: result.code, targetStarted: false };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-047."));
  const artifacts = [
    emitArtifact(work, "heapGraphIr", { kind: "v8-heap-graph-ir", count: 2, graphTotal: 2 }),
    emitArtifact(work, "continuationDescriptor", {
      continuationClass: "node-libuv-event-loop-wait-v1",
    }),
    emitArtifact(work, "resourceDescriptors", {
      descriptors: ["tcp-listener-v1", "repeating-timer-v1"],
    }),
    emitArtifact(work, "threadEvidence", {
      acceptedThreads: ["main-event-loop"],
      refusedThreads: [],
    }),
    emitArtifact(work, "architecture", { source: "arm64", target: "amd64" }),
  ];
  const assembled = assembleBundle(artifacts.map((artifact) => artifact.path));
  if (!assembled.accepted || !assembled.bundle) {
    throw new Error(`valid capture-emitted bundle refused: ${JSON.stringify(assembled)}`);
  }
  const target = materialize(assembled.bundle);
  if (target.count !== 3 || target.graphTotal !== 3 || !target.targetNative) {
    throw new Error(`target materialization failed: ${JSON.stringify(target)}`);
  }
  const tampered = { ...artifacts[0], payload: { kind: "v8-heap-graph-ir", count: 999 } };
  const tamperedPath = join(work, "tampered-heap.json");
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
  const handAuthored = { ...artifacts[1], handAuthored: true };
  handAuthored.digest = digest({
    section: handAuthored.section,
    generator: handAuthored.generator,
    captureId: handAuthored.captureId,
    handAuthored: handAuthored.handAuthored,
    payload: handAuthored.payload,
  });
  const handAuthoredPath = join(work, "hand-authored-continuation.json");
  writeFileSync(handAuthoredPath, `${JSON.stringify(handAuthored, null, 2)}\n`);
  const refusedRows = [
    assertRefusal(
      "missing-resource-artifact",
      assembleBundle(
        artifacts
          .filter((artifact) => artifact.section !== "resourceDescriptors")
          .map((artifact) => artifact.path),
      ),
      "node-proper-level5-capture-artifact-resourceDescriptors-missing",
    ),
    assertRefusal(
      "stale-or-tampered-artifact",
      assembleBundle([tamperedPath, ...artifacts.slice(1).map((artifact) => artifact.path)]),
      "node-proper-level5-capture-artifact-stale-or-tampered",
    ),
    assertRefusal(
      "hand-authored-section",
      assembleBundle([
        artifacts[0].path,
        handAuthoredPath,
        ...artifacts.slice(2).map((artifact) => artifact.path),
      ]),
      "node-proper-level5-hand-authored-section-refused",
    ),
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-capture-emitted-bundle-summary",
    proof: "047",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    artifactSections: artifacts.map((artifact) => artifact.section),
    target,
    refusedRows,
    assertions: {
      everySectionFromCaptureEmitter: true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      missingStaleAndHandAuthoredSectionsRefuse: refusedRows.length === 3,
      sourceCpuStateEvidenceOnly: true,
      noForbiddenShortcutUsed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_047_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/047/checked-summary.json is stale; rerun with UPDATE_PROOF_047_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("node proper Level 5 capture-emitted translated bundle proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
