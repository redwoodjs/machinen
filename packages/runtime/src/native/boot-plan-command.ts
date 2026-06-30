import { type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { isNativeBootPlanResult, type NativeBootPlanResult } from "./boot-plan-schema.ts";
import { defineRuntimeCommand, defineRuntimeCommandWithArgs } from "./runtime-command.ts";

type BootPlanErrorFactory = (
  code: ErrorCode,
  message: string,
  opts?: MachinenErrorOptions,
) => Error;

export function defineBootPlanProjection<
  TInput,
  TOutput,
  TResponse extends NativeBootPlanResult = NativeBootPlanResult,
>(opts: {
  data: (input: TInput) => Record<string, unknown>;
  output: (response: TResponse) => TOutput;
  isData?: (value: unknown) => value is TResponse;
  errorCode?: ErrorCode;
  makeError?: BootPlanErrorFactory;
}): (input: TInput) => TOutput {
  return defineRuntimeCommand<TInput, TResponse, TOutput>({
    command: "boot-plan",
    errorCode: opts.errorCode ?? "BOOT_MOUNTDISK_TOOL_MISSING",
    data: (input) => ({ ...minimalBootPlanData(), ...opts.data(input) }),
    output: opts.output,
    makeError: opts.makeError,
    isData: opts.isData ?? (isNativeBootPlanResult as (value: unknown) => value is TResponse),
  });
}

export function defineBootPlanProjectionWithArgs<
  TArgs extends unknown[],
  TOutput,
  TResponse extends NativeBootPlanResult = NativeBootPlanResult,
>(opts: {
  data: (...args: TArgs) => Record<string, unknown>;
  output: (response: TResponse) => TOutput;
  isData?: (value: unknown) => value is TResponse;
  errorCode?: ErrorCode;
  makeError?: BootPlanErrorFactory;
}): (...args: TArgs) => TOutput {
  return defineRuntimeCommandWithArgs<TArgs, TResponse, TOutput>({
    command: "boot-plan",
    errorCode: opts.errorCode ?? "BOOT_MOUNTDISK_TOOL_MISSING",
    data: (...args) => ({ ...minimalBootPlanData(), ...opts.data(...args) }),
    output: opts.output,
    makeError: opts.makeError,
    isData: opts.isData ?? (isNativeBootPlanResult as (value: unknown) => value is TResponse),
  });
}

function minimalBootPlanData(): Record<string, unknown> {
  return {
    memoryMib: null,
    resourcesMemory: null,
    autoMemoryMib: null,
    hostTotalBytes: null,
    vmmMemoryPreset: true,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  };
}
