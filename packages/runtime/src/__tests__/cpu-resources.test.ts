import { describe, expect, it } from "vitest";
import { _internal, BootError } from "../index.ts";

const { resolveCpuResourcePolicy } = _internal;

describe("resolveCpuResourcePolicy", () => {
  it("returns undefined when CPU resources are omitted", () => {
    expect(resolveCpuResourcePolicy(undefined)).toBeUndefined();
  });

  it("uses Phase 1 defaults when resources.cpu is present", () => {
    expect(resolveCpuResourcePolicy({})).toEqual({ maxVcpus: 1, weight: 100 });
  });

  it("accepts fractional quota and weight for a single-vCPU VM", () => {
    expect(resolveCpuResourcePolicy({ maxVcpus: 1, quotaCpus: 0.5, weight: 200 })).toEqual({
      maxVcpus: 1,
      quotaCpus: 0.5,
      weight: 200,
    });
  });

  it("rejects maxVcpus above Phase 1 support", () => {
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 2 })).toThrow(BootError);
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 2 })).toThrow(/greater than 1/);
  });

  it("rejects quota above guest-visible vCPU count", () => {
    expect(() => resolveCpuResourcePolicy({ quotaCpus: 1.5 })).toThrow(/cannot exceed/);
  });

  it("rejects malformed CPU values", () => {
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 0 })).toThrow(/positive integer/);
    expect(() => resolveCpuResourcePolicy({ quotaCpus: 0 })).toThrow(/must be > 0/);
    expect(() => resolveCpuResourcePolicy({ quotaCpus: Number.NaN })).toThrow(/must be > 0/);
    expect(() => resolveCpuResourcePolicy({ weight: 0 })).toThrow(/1..10000/);
    expect(() => resolveCpuResourcePolicy({ weight: 10_001 })).toThrow(/1..10000/);
    expect(() => resolveCpuResourcePolicy({ weight: 1.5 })).toThrow(/1..10000/);
  });
});
