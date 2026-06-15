import { describe, expect, it } from "vitest";
import { _internal, BootError } from "../index.ts";

const { multiVcpuHostSupported, resolveCpuResourcePolicy } = _internal;

describe("resolveCpuResourcePolicy", () => {
  it("returns undefined when CPU resources are omitted", () => {
    expect(resolveCpuResourcePolicy(undefined)).toBeUndefined();
  });

  it("uses defaults when resources.cpu is present", () => {
    expect(resolveCpuResourcePolicy({})).toEqual({ maxVcpus: 1, weight: 100 });
  });

  it("accepts fractional quota and weight for a single-vCPU VM", () => {
    expect(resolveCpuResourcePolicy({ maxVcpus: 1, quotaCpus: 0.5, weight: 200 })).toEqual({
      maxVcpus: 1,
      quotaCpus: 0.5,
      weight: 200,
    });
  });

  it("accepts multi-vCPU requests only on guest-visible multi-vCPU hosts", () => {
    if (multiVcpuHostSupported()) {
      expect(resolveCpuResourcePolicy({ maxVcpus: 2, quotaCpus: 1.5, weight: 200 })).toEqual({
        maxVcpus: 2,
        quotaCpus: 1.5,
        weight: 200,
      });
      return;
    }

    expect(() => resolveCpuResourcePolicy({ maxVcpus: 2 })).toThrow(BootError);
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 2 })).toThrow(
      /linux\/x64 KVM and darwin\/arm64 HVF/,
    );
  });

  it("documents the multi-vCPU host allow-list", () => {
    expect(multiVcpuHostSupported("linux", "x64")).toBe(true);
    expect(multiVcpuHostSupported("darwin", "arm64")).toBe(true);
    expect(multiVcpuHostSupported("linux", "arm64")).toBe(false);
    expect(multiVcpuHostSupported("darwin", "x64")).toBe(false);
    expect(multiVcpuHostSupported("win32", "x64")).toBe(false);
  });

  it("keeps quota as host CPU budget instead of guest-visible vCPU count", () => {
    if (multiVcpuHostSupported()) {
      expect(resolveCpuResourcePolicy({ maxVcpus: 2, quotaCpus: 0.5 })).toEqual({
        maxVcpus: 2,
        quotaCpus: 0.5,
        weight: 100,
      });
    }
  });

  it("rejects quota above guest-visible vCPU count", () => {
    expect(() => resolveCpuResourcePolicy({ quotaCpus: 1.5 })).toThrow(/cannot exceed/);
  });

  it("rejects malformed CPU values", () => {
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 0 })).toThrow(/positive integer/);
    expect(() => resolveCpuResourcePolicy({ maxVcpus: 65 })).toThrow(/<= 64/);
    expect(() => resolveCpuResourcePolicy({ quotaCpus: 0 })).toThrow(/must be > 0/);
    expect(() => resolveCpuResourcePolicy({ quotaCpus: Number.NaN })).toThrow(/must be > 0/);
    expect(() => resolveCpuResourcePolicy({ weight: 0 })).toThrow(/1..10000/);
    expect(() => resolveCpuResourcePolicy({ weight: 10_001 })).toThrow(/1..10000/);
    expect(() => resolveCpuResourcePolicy({ weight: 1.5 })).toThrow(/1..10000/);
  });
});
