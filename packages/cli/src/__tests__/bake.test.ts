import { describe, expect, it } from "vitest";

import { parseBakeArgs, resolveBakePlan } from "../commands/bake.ts";

describe("parseBakeArgs", () => {
  it("parses a recipe with defaults", () => {
    const opts = parseBakeArgs(["pi"]);

    expect(opts).toMatchObject({
      recipe: "pi",
      force: false,
      dryRun: false,
      json: false,
    });
  });

  it("parses claude bake flags", () => {
    const opts = parseBakeArgs([
      "claude",
      "--out",
      "./agent.tar.gz",
      "--force",
      "--dry-run",
      "--json",
      "--timeout-ms=12345",
    ]);

    expect(opts).toEqual({
      recipe: "claude",
      out: "./agent.tar.gz",
      force: true,
      dryRun: true,
      json: true,
      timeoutMs: 12345,
    });
  });
});

describe("resolveBakePlan", () => {
  it("uses ~/.machinen/recipes/<recipe>.tar.gz by default", () => {
    const plan = resolveBakePlan(parseBakeArgs(["claude", "--dry-run"]));

    expect(plan.recipe.name).toBe("claude");
    expect(plan.out).toMatch(/\.machinen\/recipes\/claude\.tar\.gz$/);
    expect(plan.dryRun).toBe(true);
  });
});
