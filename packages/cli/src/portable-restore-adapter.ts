import type { VmHandle } from "@machinen/runtime";

import type { ParsedRestoreCommandArgs } from "./parse-restore-args.ts";

export interface PortableRestoreAdapter<Validation, Plan, DetachedSummary> {
  readonly profile: string;
  detect(bundleDir: string): boolean;
  validate(input: PortableRestoreValidationInput): Validation;
  plan(input: PortableRestorePlanInput<Validation>): Plan;
  foregroundRestore(input: PortableRestoreExecutionInput<Plan>): Promise<number>;
  detachedRestore(input: PortableRestoreExecutionInput<Plan>): Promise<DetachedSummary>;
  verify(input: PortableRestoreVerifyInput<Plan>): Promise<void>;
  refuse(input: PortableRestoreRefusalInput<Validation>): number;
}

export interface PortableRestoreValidationInput {
  parsed: ParsedRestoreCommandArgs;
  snapDir: string;
  json: boolean;
}

export interface PortableRestorePlanInput<Validation> extends PortableRestoreValidationInput {
  validation: Validation;
}

export interface PortableRestoreExecutionInput<Plan> {
  parsed: ParsedRestoreCommandArgs;
  snapDir: string;
  json: boolean;
  plan: Plan;
}

export interface PortableRestoreVerifyInput<Plan> {
  vm: VmHandle;
  plan: Plan;
}

export interface PortableRestoreRefusalInput<Validation> extends PortableRestoreValidationInput {
  validation: Validation;
}
