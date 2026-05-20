import { describe, expect, it } from "vitest";

import {
  nativeAmbiguityClasses,
  nativeSupportBoundaryChecklist,
} from "../native-support-boundary.ts";
import { nativeProcessImageRefusalCodes } from "../native-process-image.ts";

describe("native arbitrary binary support boundary", () => {
  it("assigns every ambiguity class to metadata requirements and a stable refusal", () => {
    const refusalCodes = new Set(nativeProcessImageRefusalCodes);

    expect(nativeAmbiguityClasses.length).toBeGreaterThanOrEqual(10);
    for (const entry of nativeAmbiguityClasses) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.requiredMetadata.length).toBeGreaterThan(0);
      expect(refusalCodes.has(entry.refusalCode)).toBe(true);
    }
  });

  it("publishes a checklist that prevents overclaiming arbitrary native support", () => {
    expect(nativeSupportBoundaryChecklist()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pointer-vs-integer"),
        expect.stringContaining("active-syscall"),
        expect.stringContaining("kernel-resource"),
      ]),
    );
  });
});
