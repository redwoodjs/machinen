import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planRunAccess } from "../run-access.ts";
import type { RunRecipe } from "../run-registry.ts";

const recipe: RunRecipe = {
  schemaVersion: 1,
  publisher: "machinen.dev",
  name: "pi",
  summary: "Run pi.",
  install: ["npm install -g pi"],
  command: ["pi"],
  permissions: {
    network: true,
    workspace: "rw",
    state: [{ name: "agent", guest: "/root/.pi/agent", mode: "rw" }],
  },
};

let scratch = "";
let home = "";
let workspace = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "machinen-run-access-test-"));
  home = join(scratch, "home");
  workspace = join(scratch, "workspace");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  mkdirSync(workspace);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("run recipe host access", () => {
  it("maps state below /root to the corresponding host home path", () => {
    const plan = planRunAccess(recipe, { home, cwd: workspace });

    expect(plan.states).toEqual([
      expect.objectContaining({
        name: "agent",
        source: "home",
        host: join(home, ".pi", "agent"),
        guest: "/root/.pi/agent",
        mode: "rw",
      }),
    ]);
    expect(plan.liveMounts).toContainEqual({
      host: join(home, ".pi", "agent"),
      guest: "/root/.pi/agent",
      mode: "rw",
    });
  });

  it("normalizes repeated separators without escaping the host home", () => {
    const repeated: RunRecipe = {
      ...recipe,
      permissions: {
        ...recipe.permissions,
        state: [{ name: "agent", guest: "/root//.pi/agent", mode: "rw" }],
      },
    };

    const plan = planRunAccess(repeated, { home, cwd: workspace });

    expect(plan.states[0]!.host).toBe(join(home, ".pi", "agent"));
  });

  it("discloses symlinked ancestors even when the final state directory is missing", () => {
    const externalPi = join(scratch, "external", "pi");
    rmSync(join(home, ".pi"), { recursive: true });
    mkdirSync(externalPi, { recursive: true });
    symlinkSync(externalPi, join(home, ".pi"));

    const plan = planRunAccess(recipe, { home, cwd: workspace });

    expect(plan.states[0]).toEqual(
      expect.objectContaining({
        host: join(home, ".pi", "agent"),
        resolvedHost: join(realpathSync(externalPi), "agent"),
      }),
    );
  });

  it("keeps non-home state isolated by recipe", () => {
    const isolated: RunRecipe = {
      ...recipe,
      permissions: {
        ...recipe.permissions,
        state: [{ name: "cache", guest: "/var/cache/tool", mode: "rw" }],
      },
    };

    const plan = planRunAccess(isolated, { home, cwd: workspace });

    expect(plan.states[0]).toEqual(
      expect.objectContaining({
        source: "isolated",
        host: join(home, ".machinen", "run", "state", "machinen.dev", "pi", "cache"),
      }),
    );
  });

  it("automatically mounts the external roots needed by absolute symlinks", () => {
    const configRoot = join(home, "gh", "peterp", "ade", "config", "pi");
    const extension = join(configRoot, "extensions", "example.ts");
    mkdirSync(dirname(extension), { recursive: true });
    writeFileSync(join(configRoot, "settings.json"), "{}\n");
    writeFileSync(extension, "export default {};\n");
    symlinkSync(join(configRoot, "settings.json"), join(home, ".pi", "agent", "settings.json"));
    mkdirSync(join(home, ".pi", "agent", "extensions"));
    symlinkSync(extension, join(home, ".pi", "agent", "extensions", "example.ts"));

    const plan = planRunAccess(recipe, { home, cwd: workspace });

    expect(plan.states[0]!.linked).toEqual([
      expect.objectContaining({ host: configRoot, guest: configRoot, mode: "rw" }),
    ]);
    expect(plan.liveMounts).toContainEqual({ host: configRoot, guest: configRoot, mode: "rw" });
  });

  it("does not add mounts for relative symlinks that stay inside state", () => {
    writeFileSync(join(home, ".pi", "agent", "actual.json"), "{}\n");
    symlinkSync("actual.json", join(home, ".pi", "agent", "settings.json"));

    const plan = planRunAccess(recipe, { home, cwd: workspace });

    expect(plan.states[0]!.linked).toEqual([]);
  });

  it("resolves the external symlink closure", () => {
    const configRoot = join(home, "config", "pi");
    const sharedRoot = join(home, "shared");
    mkdirSync(configRoot, { recursive: true });
    mkdirSync(sharedRoot, { recursive: true });
    writeFileSync(join(sharedRoot, "theme.json"), "{}\n");
    symlinkSync(join(sharedRoot, "theme.json"), join(configRoot, "theme.json"));
    symlinkSync(configRoot, join(home, ".pi", "agent", "config"));

    const plan = planRunAccess(recipe, { home, cwd: workspace });

    expect(plan.states[0]!.linked).toEqual([
      expect.objectContaining({ host: configRoot, guest: configRoot, mode: "rw" }),
      expect.objectContaining({ host: sharedRoot, guest: sharedRoot, mode: "rw" }),
    ]);
  });

  it("changes the approval fingerprint when linked host access changes", () => {
    const first = planRunAccess(recipe, { home, cwd: workspace });
    const configRoot = join(home, "config", "pi");
    mkdirSync(configRoot, { recursive: true });
    writeFileSync(join(configRoot, "settings.json"), "{}\n");
    symlinkSync(join(configRoot, "settings.json"), join(home, ".pi", "agent", "settings.json"));

    const second = planRunAccess(recipe, { home, cwd: workspace });

    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it("does not make approvals workspace-specific", () => {
    const otherWorkspace = join(scratch, "other-workspace");
    mkdirSync(otherWorkspace);

    const first = planRunAccess(recipe, { home, cwd: workspace });
    const second = planRunAccess(recipe, { home, cwd: otherWorkspace });

    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
