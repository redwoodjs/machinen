import type { NativeActiveSyscallContinuation } from "./native-active-syscall-policy.ts";
import type { NativeMachineRestorePlan } from "./native-machine-restore-plan.ts";
import type { NativeMappingMaterializationStep } from "./native-mapping-materialization.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeReturnChainPlanFrame } from "./native-return-chain.ts";
import type { NativeStackWindowMaterializationPlan } from "./native-stack-translation.ts";

export const NATIVE_MACHINE_RESTORE_DESCRIPTOR_FORMAT_VERSION = 1;
export const NATIVE_MACHINE_RESTORE_DESCRIPTOR_KIND = "machinen.native-machine-restore";

export interface NativeMachineRestoreDescriptor {
  formatVersion: typeof NATIVE_MACHINE_RESTORE_DESCRIPTOR_FORMAT_VERSION;
  kind: typeof NATIVE_MACHINE_RESTORE_DESCRIPTOR_KIND;
  thread: {
    id: string;
    targetThreadCount: number;
  };
  signal: {
    blockedMasks: string[];
  };
  activeSyscalls: NativeActiveSyscallContinuation[];
  stackWindow?: {
    stackMapping: string;
    sourceWindow: { base: string; limit: string };
    targetWindow: { base: string; limit: string; sizeBytes: number };
    guards: { below: string; above: string };
    relocationCount: number;
  };
  returnChain?: {
    targetStack: { base: string; limit: string };
    frames: NativeReturnChainPlanFrame[];
  };
  mappings?: {
    steps: NativeMappingMaterializationStep[];
  };
}

export class NativeMachineRestoreDescriptorValidationError extends Error {
  constructor(
    message: string,
    readonly refusals: NativeProcessImageRefusal[] = [],
  ) {
    super(message);
    this.name = "NativeMachineRestoreDescriptorValidationError";
  }
}

export function buildNativeMachineRestoreDescriptor(
  plan: NativeMachineRestorePlan,
): NativeMachineRestoreDescriptor {
  if (plan.state !== "accepted") {
    throw new NativeMachineRestoreDescriptorValidationError(
      "cannot build descriptor for refused native restore plan",
      plan.refusals,
    );
  }
  return validateNativeMachineRestoreDescriptor({
    formatVersion: NATIVE_MACHINE_RESTORE_DESCRIPTOR_FORMAT_VERSION,
    kind: NATIVE_MACHINE_RESTORE_DESCRIPTOR_KIND,
    thread: { id: plan.thread.threadId, targetThreadCount: plan.thread.targetThreadCount },
    signal: { blockedMasks: plan.thread.signalRestore.blockedMasks },
    activeSyscalls: plan.thread.activeSyscallContinuations,
    stackWindow: stackWindowDescriptor(plan.stackWindow),
    returnChain: plan.returnChain
      ? { targetStack: plan.returnChain.targetStack, frames: plan.returnChain.frames }
      : undefined,
    mappings: plan.mappings ? { steps: plan.mappings.steps } : undefined,
  });
}

export function serializeNativeMachineRestoreDescriptor(
  descriptor: NativeMachineRestoreDescriptor,
): string {
  return `${JSON.stringify(validateNativeMachineRestoreDescriptor(descriptor), null, 2)}\n`;
}

export function parseNativeMachineRestoreDescriptor(text: string): NativeMachineRestoreDescriptor {
  return validateNativeMachineRestoreDescriptor(JSON.parse(text) as NativeMachineRestoreDescriptor);
}

export function validateNativeMachineRestoreDescriptor(
  descriptor: NativeMachineRestoreDescriptor,
): NativeMachineRestoreDescriptor {
  if (descriptor.formatVersion !== NATIVE_MACHINE_RESTORE_DESCRIPTOR_FORMAT_VERSION) {
    fail("native restore descriptor formatVersion is unsupported");
  }
  if (descriptor.kind !== NATIVE_MACHINE_RESTORE_DESCRIPTOR_KIND) {
    fail("native restore descriptor kind is unsupported");
  }
  if (!descriptor.thread?.id || descriptor.thread.targetThreadCount < 1) {
    fail("native restore descriptor requires a target thread");
  }
  if (!descriptor.signal || !Array.isArray(descriptor.signal.blockedMasks)) {
    fail("native restore descriptor requires signal mask state");
  }
  if (!Array.isArray(descriptor.activeSyscalls)) {
    fail("native restore descriptor requires active syscall state");
  }
  if (descriptor.stackWindow) {
    validateStackWindowDescriptor(descriptor.stackWindow);
  }
  if (descriptor.returnChain) {
    validateReturnChainDescriptor(descriptor.returnChain);
  }
  if (descriptor.mappings && !Array.isArray(descriptor.mappings.steps)) {
    fail("native restore descriptor mapping steps must be an array");
  }
  return descriptor;
}

function stackWindowDescriptor(
  plan: (NativeStackWindowMaterializationPlan & { state: "materialized" }) | undefined,
): NativeMachineRestoreDescriptor["stackWindow"] {
  return plan
    ? {
        stackMapping: plan.stackMapping,
        sourceWindow: plan.sourceWindow,
        targetWindow: plan.targetWindow,
        guards: plan.guards,
        relocationCount: plan.relocations.length,
      }
    : undefined;
}

function validateStackWindowDescriptor(
  descriptor: NonNullable<NativeMachineRestoreDescriptor["stackWindow"]>,
): void {
  if (!descriptor.stackMapping || descriptor.targetWindow.sizeBytes <= 0) {
    fail("native restore descriptor stack window is invalid");
  }
  assertAddress(descriptor.sourceWindow.base, "stack source base");
  assertAddress(descriptor.sourceWindow.limit, "stack source limit");
  assertAddress(descriptor.targetWindow.base, "stack target base");
  assertAddress(descriptor.targetWindow.limit, "stack target limit");
  assertAddress(descriptor.guards.below, "stack guard below");
  assertAddress(descriptor.guards.above, "stack guard above");
}

function validateReturnChainDescriptor(
  descriptor: NonNullable<NativeMachineRestoreDescriptor["returnChain"]>,
): void {
  assertAddress(descriptor.targetStack.base, "return-chain stack base");
  assertAddress(descriptor.targetStack.limit, "return-chain stack limit");
  if (!Array.isArray(descriptor.frames) || descriptor.frames.length === 0) {
    fail("native restore descriptor return chain must contain frames");
  }
}

function assertAddress(value: string, field: string): void {
  if (!/^0x[0-9a-f]+$/i.test(value)) {
    fail(`${field} must be a hex address`);
  }
}

function fail(message: string): never {
  throw new NativeMachineRestoreDescriptorValidationError(message);
}
