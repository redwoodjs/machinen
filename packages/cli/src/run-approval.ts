import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { VerifiedRunRecipe } from "./run-registry.ts";

interface RunApproval {
  source: string;
  name: string;
  keyId: string;
  recipeDigest: string;
  accessFingerprint: string;
  approvedAt: string;
}

interface RunApprovalStore {
  schemaVersion: 2;
  approvals: Record<string, RunApproval>;
}

function runApprovalsPath(): string {
  return (
    process.env.MACHINEN_RUN_APPROVALS ?? join(homedir(), ".machinen", "run", "approvals.json")
  );
}

export function hasRunRecipeApproval(
  recipe: VerifiedRunRecipe,
  accessFingerprint: string,
  path = runApprovalsPath(),
): boolean {
  return readApprovalStore(path).approvals[approvalId(recipe, accessFingerprint)] !== undefined;
}

export function approveRunRecipe(
  recipe: VerifiedRunRecipe,
  accessFingerprint: string,
  path = runApprovalsPath(),
): void {
  const store = readApprovalStore(path);
  store.approvals[approvalId(recipe, accessFingerprint)] = {
    source: recipe.source,
    name: recipe.recipe.name,
    keyId: recipe.keyId,
    recipeDigest: recipe.digest,
    accessFingerprint,
    approvedAt: new Date().toISOString(),
  };
  writeApprovalStore(path, store);
}

function approvalId(recipe: VerifiedRunRecipe, accessFingerprint: string): string {
  return createHash("sha256").update(`${recipe.digest}\0${accessFingerprint}`).digest("hex");
}

function readApprovalStore(path: string): RunApprovalStore {
  if (!existsSync(path)) {
    return emptyApprovalStore();
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `could not read run approvals at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (isLegacyApprovalStore(value)) {
    // v1 approved only recipe bytes. It cannot authorize newly resolved
    // host-state and linked-root access, so require one fresh approval.
    return emptyApprovalStore();
  }
  if (!isApprovalStore(value)) {
    throw new Error(`invalid run approvals file at ${path}`);
  }
  return value;
}

function emptyApprovalStore(): RunApprovalStore {
  return { schemaVersion: 2, approvals: {} };
}

function isApprovalStore(value: unknown): value is RunApprovalStore {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Partial<RunApprovalStore>;
  if (candidate.schemaVersion !== 2 || !isObject(candidate.approvals)) {
    return false;
  }
  return Object.entries(candidate.approvals).every(
    ([digest, approval]) => /^[a-f0-9]{64}$/.test(digest) && isApproval(approval),
  );
}

function isLegacyApprovalStore(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }
  return value.schemaVersion === 1 && isObject(value.approvals);
}

function isApproval(value: unknown): value is RunApproval {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Partial<RunApproval>;
  return (
    typeof candidate.source === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.keyId === "string" &&
    isDigest(candidate.recipeDigest) &&
    isDigest(candidate.accessFingerprint) &&
    typeof candidate.approvedAt === "string"
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function writeApprovalStore(path: string, store: RunApprovalStore): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}
