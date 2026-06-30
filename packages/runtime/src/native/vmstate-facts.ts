import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { defineRuntimeCommand } from "./runtime-command.ts";
import type { VmstateFacts } from "../vm/vmstate-metadata.ts";

export const readVmstateFactsNative = defineRuntimeCommand<string, VmstateFacts>({
  command: "vmstate-facts",
  errorCode: "BOOT_SNAPSHOT_NOT_FOUND",
  data: (path) => ({ path }),
  makeError: vmstateFactsError,
  isData: isVmstateFacts,
});

function isVmstateFacts(value: unknown): value is VmstateFacts {
  if (!value || typeof value !== "object") {
    return false;
  }
  const facts = value as Partial<VmstateFacts>;
  return [
    isVmstateArch(facts.arch),
    typeof facts.topologyHash === "string",
    isNonNegativeInteger(facts.sectionCount),
    isOptionalBoolean(facts.guestPauthActive),
    isOptionalString(facts.sctlrEl1),
  ].every(Boolean);
}

function isVmstateArch(value: unknown): value is VmstateFacts["arch"] {
  return value === "arm64" || value === "amd64" || value === "unknown";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function vmstateFactsError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}
