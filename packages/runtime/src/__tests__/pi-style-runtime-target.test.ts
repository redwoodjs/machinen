import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/pi-style-runtime-target.ts");
const TSX = join(REPO_ROOT, "node_modules/.bin/tsx");
const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi-style runtime target proof", () => {
  it("restores semantic agent state and refuses full live process restore", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-pi-style-runtime-target-"));
    TMP.push(outDir);
    const result = spawnSync(TSX, [SCRIPT, "verify", "--out-dir", outDir, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      bundleDir: string;
      semanticStateRestored: boolean;
      identityPreserved: boolean;
      sharedPreserved: boolean;
      asyncContinuation: string;
      liveProcessRestored: boolean;
      liveRefusal: { code: string };
      resourceRefusals: string[];
      buildIdentityAccepted: boolean;
    };
    expect(summary).toMatchObject({
      semanticStateRestored: true,
      identityPreserved: true,
      sharedPreserved: true,
      asyncContinuation: "session-439:3",
      liveProcessRestored: false,
      liveRefusal: { code: "fd-kind-unsupported" },
      buildIdentityAccepted: true,
    });
    expect(summary.resourceRefusals).toEqual(
      expect.arrayContaining(["fd-kind-unsupported", "resource-unsupported"]),
    );
    expect(validatePortableSnapshotBundle(summary.bundleDir).runtimeAdapter?.target.id).toBe(
      "pi-style-node-agent",
    );
  });
});
