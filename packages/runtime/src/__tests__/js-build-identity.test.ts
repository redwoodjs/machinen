import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureJsBuildIdentity, verifyJsBuildIdentity } from "../js-build-identity.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "machinen-js-build-identity-"));
  TMP.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(root, "src/index.ts"),
    'import { value } from "./state";\nimport { readFileSync } from "node:fs";\nexport const result = value + readFileSync;\n',
  );
  writeFileSync(join(root, "src/state.ts"), "export const value = 436;\n");
  return root;
}

describe("JavaScript build identity sidecar", () => {
  it("captures package, lockfile, source, and module graph identity", () => {
    const root = fixture();
    const sidecar = captureJsBuildIdentity({ rootDir: root, entrypoints: ["src/index.ts"] });

    expect(sidecar.kind).toBe("machinen-js-build-identity");
    expect(sidecar.build.identity.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.build.identity.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.build.identity.lockfileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.build.identity.moduleGraphSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.files.map((file) => file.path)).toEqual(["src/index.ts", "src/state.ts"]);
    expect(sidecar.build.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: "node:fs", kind: "builtin" }),
        expect.objectContaining({ specifier: "./state", kind: "relative" }),
      ]),
    );
  });

  it("accepts matching builds and refuses stale targets", () => {
    const root = fixture();
    const sidecar = captureJsBuildIdentity({ rootDir: root, entrypoints: ["src/index.ts"] });
    expect(
      verifyJsBuildIdentity(sidecar, { rootDir: root, entrypoints: ["src/index.ts"] }),
    ).toMatchObject({
      accepted: true,
    });

    writeFileSync(join(root, "src/state.ts"), "export const value = 999;\n");
    expect(
      verifyJsBuildIdentity(sidecar, { rootDir: root, entrypoints: ["src/index.ts"] }),
    ).toMatchObject({
      accepted: false,
      refusal: { code: "target-build-mismatch" },
    });
  });
});
