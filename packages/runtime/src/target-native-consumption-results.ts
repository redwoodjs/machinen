export type TargetNativeConsumptionStatus = "passed" | "failed";

export interface TargetNativeConsumptionEvent {
  status?: TargetNativeConsumptionStatus;
}

export interface TargetNativeConsumptionEvents {
  nativeStackWindowMaterialization?: TargetNativeConsumptionEvent;
  nativePrivateMemoryRestore?: TargetNativeConsumptionEvent;
  nativeExecutableMapping?: TargetNativeConsumptionEvent;
  nativeSignalRestore?: TargetNativeConsumptionEvent;
  nativeActiveSyscallRestore?: TargetNativeConsumptionEvent;
}

export function parseTargetNativeConsumptionEvents(
  actualResumeEvent: Record<string, unknown> | undefined,
): TargetNativeConsumptionEvents {
  return {
    nativeStackWindowMaterialization: parseNativeConsumption(
      actualResumeEvent,
      "nativeStackWindowMaterialization",
    ),
    nativePrivateMemoryRestore: parseNativeConsumption(
      actualResumeEvent,
      "nativePrivateMemoryRestore",
    ),
    nativeExecutableMapping: parseNativeConsumption(actualResumeEvent, "nativeExecutableMapping"),
    nativeSignalRestore: parseNativeConsumption(actualResumeEvent, "nativeSignalRestore"),
    nativeActiveSyscallRestore: parseNativeConsumption(
      actualResumeEvent,
      "nativeActiveSyscallRestore",
    ),
  };
}

export function targetNativeConsumptionFields(events: TargetNativeConsumptionEvents): {
  targetStackWindowMaterializationResult?: TargetNativeConsumptionStatus;
  targetPrivateMemoryRestoreResult?: TargetNativeConsumptionStatus;
  targetExecutableMappingResult?: TargetNativeConsumptionStatus;
  targetSignalRestoreResult?: TargetNativeConsumptionStatus;
  targetActiveSyscallRestoreResult?: TargetNativeConsumptionStatus;
} {
  return {
    targetStackWindowMaterializationResult: events.nativeStackWindowMaterialization?.status,
    targetPrivateMemoryRestoreResult: events.nativePrivateMemoryRestore?.status,
    targetExecutableMappingResult: events.nativeExecutableMapping?.status,
    targetSignalRestoreResult: events.nativeSignalRestore?.status,
    targetActiveSyscallRestoreResult: events.nativeActiveSyscallRestore?.status,
  };
}

export function targetNativeConsumptionPassed(events: TargetNativeConsumptionEvents): boolean {
  return [
    events.nativeStackWindowMaterialization,
    events.nativePrivateMemoryRestore,
    events.nativeExecutableMapping,
    events.nativeSignalRestore,
    events.nativeActiveSyscallRestore,
  ].every((event) => event === undefined || event.status === "passed");
}

function parseNativeConsumption(
  actualResumeEvent: Record<string, unknown> | undefined,
  key: string,
): TargetNativeConsumptionEvent | undefined {
  const value = actualResumeEvent?.[key];
  return isNativeConsumptionEvent(value) ? value : undefined;
}

function isNativeConsumptionEvent(value: unknown): value is TargetNativeConsumptionEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === "passed" || status === "failed";
}
