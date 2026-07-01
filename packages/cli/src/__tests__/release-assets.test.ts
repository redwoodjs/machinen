import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = join(ROOT, "scripts/release-base-assets.mjs");
const BUILD_BASE_ASSETS = join(ROOT, "scripts/build-base-assets.sh");
const ROOTFS = "rootfs-debian-arm64.tar.gz";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "machinen-release-assets-"));
  tmpDirs.push(dir);
  return dir;
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function writeAsset(dir: string, name: string, body: string, sidecarBody = body): void {
  writeFileSync(join(dir, name), body);
  writeFileSync(join(dir, `${name}.sha256`), `${sha256(sidecarBody)}  ${name}\n`);
}

function runVerify(remoteDir: string, assets = [ROOTFS], env: Record<string, string> = {}) {
  return spawnSync(
    "node",
    [SCRIPT, "verify", "--tag", "runtime-vtest", ...assets.flatMap((asset) => ["--asset", asset])],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MACHINEN_RELEASE_ASSETS_BASE_URL: `file://${remoteDir}`,
        MACHINEN_RELEASE_VERIFY_TRIES: "1",
        MACHINEN_RELEASE_VERIFY_SLEEP: "0",
        ...env,
      },
      encoding: "utf8",
    },
  );
}

describe("scripts/build-base-assets.sh", () => {
  it("makes fnm default Node installs available to login and attach shells", () => {
    const script = readFileSync(BUILD_BASE_ASSETS, "utf8");

    expect(script).toContain("install -m 0755 -d /work/rootfs/opt/fnm /work/rootfs/etc/profile.d");
    expect(script).toContain('export FNM_DIR="${FNM_DIR:-/opt/fnm}"');
    expect(script).toContain('export PATH="$FNM_DIR/aliases/default/bin:$PATH"');
    expect(script).toContain("/work/rootfs/etc/profile.d/machinen-fnm.sh");
    expect(script).toContain("/work/rootfs/etc/bash.bashrc");
    expect(script).toContain(". /etc/profile.d/machinen-fnm.sh");
  });
});

describe("scripts/release-base-assets.mjs verify", () => {
  it("passes when a published asset matches its sidecar", () => {
    const remote = tempDir();
    writeAsset(remote, ROOTFS, "rootfs bytes\n");

    const result = runVerify(remote);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`ok ${ROOTFS}`);
    expect(result.stdout).toContain("release-assets: verified 1 asset(s) for runtime-vtest");
  });

  it("reproduces #9 by failing when published bytes do not match the published sidecar", () => {
    const remote = tempDir();
    writeAsset(
      remote,
      ROOTFS,
      "actual rootfs bytes\n",
      "sidecar was generated for different bytes\n",
    );

    const result = runVerify(remote);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(`checksum mismatch for ${ROOTFS}`);
    expect(output).toContain(sha256("sidecar was generated for different bytes\n"));
    expect(output).toContain(sha256("actual rootfs bytes\n"));
  });

  it("fails when the public release is stale relative to the just-uploaded local sidecar", () => {
    const remote = tempDir();
    const local = tempDir();
    writeAsset(remote, ROOTFS, "old but internally consistent rootfs\n");
    writeAsset(local, ROOTFS, "new rootfs from this release job\n");

    const result = runVerify(remote, [ROOTFS], {
      MACHINEN_RELEASE_ASSETS_DIR: local,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(`published checksum sidecar mismatch for ${ROOTFS}`);
    expect(output).toContain(sha256("new rootfs from this release job\n"));
    expect(output).toContain(sha256("old but internally consistent rootfs\n"));
  });
});
