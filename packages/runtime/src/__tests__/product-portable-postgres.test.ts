import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_PORTABLE_POSTGRES_DUMP,
  PRODUCT_PORTABLE_POSTGRES_MANIFEST,
  PRODUCT_PORTABLE_POSTGRES_REFUSAL,
  PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY,
  createProductPortablePostgresSnapshot,
  restoreProductPortablePostgresSnapshot,
} from "../product-portable-postgres.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "product-portable-postgres-"));
}

function fixtureFiles(root: string): { dump: string; verifier: string } {
  mkdirSync(root, { recursive: true });
  const dump = join(root, "pg.dump");
  const verifier = join(root, "verify.txt");
  writeFileSync(dump, "-- logical PostgreSQL dump\nCREATE TABLE machinen(id int);\n");
  writeFileSync(verifier, "fingerprint:42\n");
  return { dump, verifier };
}

describe("product portable PostgreSQL descriptor", () => {
  it("captures and restores the implemented arm64 -> amd64 product subset", () => {
    const root = tempDir();
    const { dump } = fixtureFiles(root);
    const bundle = join(root, "bundle");

    const capture = createProductPortablePostgresSnapshot({
      outDir: bundle,
      sourceArch: "arm64",
      targetArch: "amd64",
      logicalDumpPath: dump,
      sourceVerifierOutput: "fingerprint:42",
      postgresVersion: "15.8",
      checkpointLsn: "0/16B6C50",
      activeTransactions: 0,
      activeSessions: 0,
    });

    expect(capture.state).toBe("completed");
    expect(capture.migrationCompleted).toBe(true);
    expect(readFileSync(join(bundle, PRODUCT_PORTABLE_POSTGRES_MANIFEST), "utf8")).toContain(
      "implemented-product-support",
    );
    expect(readFileSync(join(bundle, PRODUCT_PORTABLE_POSTGRES_DUMP), "utf8")).toContain(
      "CREATE TABLE",
    );

    const restore = restoreProductPortablePostgresSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: "fingerprint:42",
    });

    expect(restore.migrationCompleted).toBe(true);
    expect(restore.targetVerifierResult).toBe("passed");
    expect(readFileSync(join(bundle, PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY), "utf8")).toContain(
      "postgres-clean-quiesced-logical-v1",
    );
  });

  it("captures and restores the implemented amd64 -> arm64 product subset", () => {
    const root = tempDir();
    const { dump } = fixtureFiles(root);
    const bundle = join(root, "bundle-reverse");

    createProductPortablePostgresSnapshot({
      outDir: bundle,
      sourceArch: "amd64",
      targetArch: "arm64",
      logicalDumpPath: dump,
      sourceVerifierOutput: "fingerprint:42",
      postgresVersion: "15.8",
      checkpointLsn: "0/16B6C50",
    });

    const restore = restoreProductPortablePostgresSnapshot({
      bundleDir: bundle,
      targetArch: "arm64",
      targetVerifierOutput: "fingerprint:42",
    });

    expect(restore.migrationCompleted).toBe(true);
    expect(restore.sourceArch).toBe("amd64");
    expect(restore.targetArch).toBe("arm64");
  });

  it("refuses unsafe source state with stable code and migrationCompleted=false", () => {
    const root = tempDir();
    const { dump } = fixtureFiles(root);
    const bundle = join(root, "refused");

    const capture = createProductPortablePostgresSnapshot({
      outDir: bundle,
      sourceArch: "arm64",
      targetArch: "amd64",
      logicalDumpPath: dump,
      sourceVerifierOutput: "fingerprint:42",
      postgresVersion: "15.8",
      checkpointLsn: "0/16B6C50",
      activeTransactions: 1,
    });

    expect(capture.state).toBe("refused");
    expect(capture.migrationCompleted).toBe(false);
    if (capture.state !== "refused") {
      throw new Error("expected refused capture");
    }
    expect(capture.refusal.expectedRefusalCode).toBe("postgres-active-transaction-unsupported");
    expect(readFileSync(join(bundle, PRODUCT_PORTABLE_POSTGRES_REFUSAL), "utf8")).toContain(
      "postgres-active-transaction-unsupported",
    );

    const restore = restoreProductPortablePostgresSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: "fingerprint:42",
    });
    expect(restore.migrationCompleted).toBe(false);
    expect(restore.targetVerifierResult).toBe("not-run");
  });

  it("refuses tampered dumps and target verifier mismatches", () => {
    const root = tempDir();
    const { dump } = fixtureFiles(root);
    const bundle = join(root, "tamper");

    createProductPortablePostgresSnapshot({
      outDir: bundle,
      sourceArch: "arm64",
      targetArch: "amd64",
      logicalDumpPath: dump,
      sourceVerifierOutput: "fingerprint:42",
      postgresVersion: "15.8",
      checkpointLsn: "0/16B6C50",
    });

    const mismatch = restoreProductPortablePostgresSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: "fingerprint:43",
    });
    expect(mismatch.migrationCompleted).toBe(false);
    expect(mismatch.refusal?.expectedRefusalCode).toBe("postgres-target-verifier-mismatch");

    writeFileSync(join(bundle, PRODUCT_PORTABLE_POSTGRES_DUMP), "tampered");
    const tampered = restoreProductPortablePostgresSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: "fingerprint:42",
    });
    expect(tampered.migrationCompleted).toBe(false);
    expect(tampered.refusal?.expectedRefusalCode).toBe("postgres-logical-dump-integrity-mismatch");
  });
});
