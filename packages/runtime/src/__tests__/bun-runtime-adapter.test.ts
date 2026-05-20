import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectBunPackagedExecutable, probeBunRuntimeAdapter } from "../bun-runtime-adapter.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Bun runtime adapter probe", () => {
  it("returns a stable adapter-missing refusal when Bun is unavailable", () => {
    const probe = probeBunRuntimeAdapter({ bunCommand: "definitely-not-bun-for-machinen" });
    expect(probe).toMatchObject({
      runtime: "bun",
      available: false,
      refusal: { code: "runtime-adapter-missing" },
    });
  });

  it("checks packaged Bun executable identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-bun-adapter-"));
    TMP.push(dir);
    const exe = join(dir, "app-bun");
    writeFileSync(exe, "bun-packaged-fixture");

    const identity = inspectBunPackagedExecutable(exe);
    expect(identity).toMatchObject({ accepted: true, identity: { path: exe } });
    if (identity.accepted) {
      expect(identity.identity.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses missing packaged executable identity with target-build-mismatch", () => {
    expect(inspectBunPackagedExecutable("/tmp/machinen-missing-bun-app")).toMatchObject({
      accepted: false,
      refusal: { code: "target-build-mismatch" },
    });
  });
});
