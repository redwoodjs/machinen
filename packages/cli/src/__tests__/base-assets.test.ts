import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  arch: () => "arm64",
  homedir: () => mocks.home,
}));

const assets: Record<string, string> = {
  "Image-arm64": "kernel bytes",
  "virt-arm64.dtb": "dtb bytes",
  "rootfs-debian-arm64.tar.gz": "rootfs tar bytes",
  "rootfs-debian-arm64.img.gz": "rootfs gzip bytes",
  "rootfs-debian-arm64.img.zst": "rootfs zstd bytes",
};

describe("base asset downloads", () => {
  let ensureBaseAssets: typeof import("../base-assets.ts").ensureBaseAssets;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    mocks.home = mkdtempSync(join(tmpdir(), "machinen-base-assets-test-"));
    ({ ensureBaseAssets } = await import("../base-assets.ts"));
    vi.stubGlobal("fetch", vi.fn(fetchAsset));
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterAll(() => {
    stderr.mockRestore();
    vi.unstubAllGlobals();
    rmSync(mocks.home, { recursive: true, force: true });
  });

  it("streams aggregate progress while fetching and caches verified assets", async () => {
    const base = await ensureBaseAssets("runtime-vtest");
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");

    expect(output).toContain("machinen: downloading base assets: 100%");
    expect(readFileSync(join(base, "Image"), "utf8")).toBe(assets["Image-arm64"]);
    expect(readFileSync(join(base, "rootfs.tar.gz"), "utf8")).toBe(
      assets["rootfs-debian-arm64.tar.gz"],
    );
    expect(fetch).toHaveBeenCalledTimes(10);
  });
});

function fetchAsset(input: string | URL | Request): Promise<Response> {
  const name = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1)!);
  if (name.endsWith(".sha256")) {
    const assetName = name.slice(0, -".sha256".length);
    const contents = assets[assetName]!;
    const checksum = createHash("sha256").update(contents).digest("hex");
    return Promise.resolve(new Response(`${checksum}  ${assetName}\n`));
  }
  const contents = assets[name]!;
  return Promise.resolve(
    new Response(contents, { headers: { "content-length": String(Buffer.byteLength(contents)) } }),
  );
}
