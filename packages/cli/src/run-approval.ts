import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { VerifiedRunRecipe } from "./run-registry.ts";

interface RunApproval {
  source: string;
  name: string;
  keyId: string;
  approvedAt: string;
}

interface RunApprovalStore {
  schemaVersion: 1;
  approvals: Record<string, RunApproval>;
}

export function runApprovalsPath(): string {
  return (
    process.env.MACHINEN_RUN_APPROVALS ?? join(homedir(), ".machinen", "run", "approvals.json")
  );
}

export function hasRunRecipeApproval(
  recipe: VerifiedRunRecipe,
  path = runApprovalsPath(),
): boolean {
  return readApprovalStore(path).approvals[recipe.digest] !== undefined;
}

export function approveRunRecipe(recipe: VerifiedRunRecipe, path = runApprovalsPath()): void {
  const store = readApprovalStore(path);
  store.approvals[recipe.digest] = {
    source: recipe.source,
    name: recipe.recipe.name,
    keyId: recipe.keyId,
    approvedAt: new Date().toISOString(),
  };
  writeApprovalStore(path, store);
}

function readApprovalStore(path: string): RunApprovalStore {
  if (!existsSync(path)) {
    return { schemaVersion: 1, approvals: {} };
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `could not read run approvals at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isApprovalStore(value)) {
    throw new Error(`invalid run approvals file at ${path}`);
  }
  return value;
}

function isApprovalStore(value: unknown): value is RunApprovalStore {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<RunApprovalStore>;
  if (candidate.schemaVersion !== 1 || !isObject(candidate.approvals)) {
    return false;
  }
  return Object.entries(candidate.approvals).every(
    ([digest, approval]) => /^[a-f0-9]{64}$/.test(digest) && isApproval(approval),
  );
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
    typeof candidate.approvedAt === "string"
  );
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
