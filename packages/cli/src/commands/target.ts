import { list, type RegistryEntry } from "@machinen/runtime";

import { handleError, die } from "../errors.ts";
import { extractTarget, type Target } from "../parse-target.ts";

export function resolveTarget(args: string[], cmd: string): { target: Target; rest: string[] } {
  try {
    return extractTarget(args, cmd);
  } catch (err) {
    handleError(err);
  }
}

export function parseTargetFlags(args: string[], cmd: string): Target {
  const { target, rest } = resolveTarget(args, cmd);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  return target;
}

export function lookupEntry(target: { name: string } | { pid: number }): RegistryEntry | undefined {
  return list().find((entry) => entryMatchesTarget(entry, target));
}

function entryMatchesTarget(
  entry: RegistryEntry,
  target: { name: string } | { pid: number },
): boolean {
  if ("name" in target) {
    return entry.name === target.name;
  }
  return entry.pid === target.pid;
}

export function describeTarget(target: { name: string } | { pid: number }): string {
  return "name" in target ? `name ${target.name}` : `pid ${target.pid}`;
}

export function entryLabel(entry: RegistryEntry): string {
  return entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
}
