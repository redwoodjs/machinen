import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  home: "",
  attach: vi.fn(),
  boot: vi.fn(),
  list: vi.fn(),
  provision: vi.fn(),
  resolveCliBaseAssets: vi.fn(),
  approveRunRecipe: vi.fn(),
  hasRunRecipeApproval: vi.fn(),
  loadRunRecipe: vi.fn(),
  loadRunRegistry: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => mocks.home,
}));

vi.mock("@machinen/runtime", () => ({
  attach: mocks.attach,
  boot: mocks.boot,
  list: mocks.list,
  provision: mocks.provision,
}));

vi.mock("../base-assets.ts", () => ({
  resolveCliBaseAssets: mocks.resolveCliBaseAssets,
}));

vi.mock("../run-approval.ts", () => ({
  approveRunRecipe: mocks.approveRunRecipe,
  hasRunRecipeApproval: mocks.hasRunRecipeApproval,
}));

vi.mock("../run-registry.ts", () => ({
  loadRunRecipe: mocks.loadRunRecipe,
  loadRunRegistry: mocks.loadRunRegistry,
}));

import { cmdRun } from "../commands/run.ts";

const baseAssets = {
  baseDir: "/cache/runtime-v0.8.0/bases/debian-arm64",
  defaultImagePath: "/cache/runtime-v0.8.0/bases/debian-arm64/rootfs.tar.gz",
  kernelPath: "/cache/runtime-v0.8.0/bases/debian-arm64/Image",
  dtbPath: "/cache/runtime-v0.8.0/bases/debian-arm64/virt.dtb",
};

const verifiedRecipe = {
  recipe: {
    schemaVersion: 1,
    publisher: "machinen.dev",
    name: "pi",
    summary: "Run pi.",
    install: ["npm install -g @mariozechner/pi-coding-agent"],
    command: ["pi"],
    permissions: {
      network: true,
      workspace: "rw",
      state: [],
    },
  },
  source: "https://machinen.dev/run/pi",
  digest: "a".repeat(64),
  keyId: "machinen.dev-2026-01",
};

describe("machinen run recipe images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.home = mkdtempSync(join(tmpdir(), "machinen-run-test-"));
    mocks.hasRunRecipeApproval.mockReturnValue(true);
    mocks.loadRunRecipe.mockResolvedValue(verifiedRecipe);
    mocks.resolveCliBaseAssets.mockResolvedValue(baseAssets);
    mocks.provision.mockResolvedValue({ imagePath: "unused", sizeBytes: 1, elapsedMs: 1 });
    mocks.boot.mockResolvedValue({ wait: async () => ({ code: 0 }) });
    mocks.list.mockReturnValue([]);
  });

  afterEach(() => {
    rmSync(mocks.home, { recursive: true, force: true });
  });

  it("automatically fetches and supplies base assets before baking", async () => {
    await expect(cmdRun([verifiedRecipe.source])).resolves.toBe(0);

    expect(mocks.resolveCliBaseAssets).toHaveBeenCalledOnce();
    expect(mocks.resolveCliBaseAssets.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.provision.mock.invocationCallOrder[0]!,
    );
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        base: baseAssets.defaultImagePath,
        kernel: baseAssets.kernelPath,
        dtb: baseAssets.dtbPath,
      }),
    );
    expect(mocks.boot).toHaveBeenCalledWith(
      expect.objectContaining({
        kernel: baseAssets.kernelPath,
        dtb: baseAssets.dtbPath,
      }),
    );
  });

  it("resolves base assets before booting a cached recipe image", async () => {
    const imageDir = join(
      mocks.home,
      ".machinen",
      "run",
      "images",
      verifiedRecipe.recipe.name,
      verifiedRecipe.digest,
    );
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(join(imageDir, "rootfs.tar.gz"), "cached image");

    await expect(cmdRun([verifiedRecipe.source])).resolves.toBe(0);

    expect(mocks.resolveCliBaseAssets).toHaveBeenCalledOnce();
    expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.boot).toHaveBeenCalledWith(
      expect.objectContaining({
        kernel: baseAssets.kernelPath,
        dtb: baseAssets.dtbPath,
      }),
    );
  });
});
