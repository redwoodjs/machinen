import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { VmstateFacts } from "../vm/vmstate-metadata.ts";

export function readVmstateFactsNative(path: string): VmstateFacts {
  return callRuntimeHelper({
    command: "vmstate-facts",
    data: { path },
    errorCode: "BOOT_SNAPSHOT_NOT_FOUND",
    makeError: vmstateFactsError,
    isData: isVmstateFacts,
  });
}

function isVmstateFacts(value: unknown): value is VmstateFacts {
  if (!value || typeof value !== "object") {
    return false;
  }
  const facts = value as Partial<VmstateFacts>;
  return (
    (facts.arch === "arm64" || facts.arch === "amd64" || facts.arch === "unknown") &&
    typeof facts.topologyHash === "string" &&
    typeof facts.sectionCount === "number" &&
    Number.isInteger(facts.sectionCount) &&
    facts.sectionCount >= 0 &&
    (facts.guestPauthActive === undefined || typeof facts.guestPauthActive === "boolean") &&
    (facts.sctlrEl1 === undefined || typeof facts.sctlrEl1 === "string")
  );
}

const vmstateFactsError = (code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error =>
  new BootError(code, message, opts);
