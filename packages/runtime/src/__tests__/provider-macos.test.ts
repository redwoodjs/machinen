// macOS provider behavior against a fake runner and fake SSH. No
// Virtualization.framework and no guest are involved, so these assert the
// runtime's contract: validation order, readiness, cleanup, and typed
// refusals.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveMacosBundle,
  validateMacosResources,
  validateMacosSsh,
} from "../provider/macos/config.ts";
import { readRunnerStatus, waitForRunnerRunning } from "../provider/macos/runner-status.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "machinen-macos-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeBundle(name = "bundle"): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "disk.img"), "disk");
  writeFileSync(join(path, "aux.bin"), "aux");
  writeFileSync(join(path, "hw.bin"), "hw");
  writeFileSync(
    join(path, "config.json"),
    JSON.stringify({
      diskImage: "disk.img",
      auxiliaryStorage: "aux.bin",
      hardwareModel: "hw.bin",
    }),
  );
  return path;
}

describe("macOS bundle validation", () => {
  it("resolves a prepared bundle to absolute members", () => {
    const path = makeBundle();
    const bundle = resolveMacosBundle({ kind: "prepared-bundle", path });
    expect(bundle.path).toBe(path);
    expect(bundle.diskImage).toBe(join(path, "disk.img"));
    expect(bundle.auxiliaryStorage).toBe(join(path, "aux.bin"));
    expect(bundle.hardwareModel).toBe(join(path, "hw.bin"));
  });

  it("refuses a missing bundle", () => {
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path: join(root, "nope") });
      } catch (e) {
        return e;
      }
    })();
    expect((err as { code?: string }).code).toBe("PROVIDER_IMAGE_INVALID");
    expect((err as Error).message).toContain("not found");
  });

  it("refuses an IPSW by name with a reason", () => {
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path: join(root, "guest.ipsw") });
      } catch (e) {
        return e;
      }
    })();
    expect((err as { code?: string }).code).toBe("PROVIDER_IMAGE_INVALID");
    expect((err as Error).message).toContain("IPSW");
  });

  it("refuses a Tart image by name", () => {
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path: join(root, "base.tart") });
      } catch (e) {
        return e;
      }
    })();
    expect((err as { code?: string }).code).toBe("PROVIDER_IMAGE_INVALID");
    expect((err as Error).message).toContain("Tart");
  });

  it("refuses a .vzvm path because no universal format exists", () => {
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path: join(root, "guest.vzvm") });
      } catch (e) {
        return e;
      }
    })();
    expect((err as Error).message).toContain(".vzvm");
  });

  it("refuses a directory without config.json", () => {
    const path = join(root, "empty");
    mkdirSync(path);
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path });
      } catch (e) {
        return e;
      }
    })();
    expect((err as Error).message).toContain("config.json");
  });

  it("refuses a bundle whose config names a missing disk", () => {
    const path = join(root, "broken");
    mkdirSync(path);
    writeFileSync(join(path, "config.json"), JSON.stringify({ diskImage: "absent.img" }));
    const err = (() => {
      try {
        resolveMacosBundle({ kind: "prepared-bundle", path });
      } catch (e) {
        return e;
      }
    })();
    expect((err as Error).message).toContain("absent.img");
  });
});

describe("macOS SSH and resource validation", () => {
  it("requires an identity file and refuses password auth", () => {
    const err = (() => {
      try {
        validateMacosSsh({ user: "vm", identityFile: "" });
      } catch (e) {
        return e;
      }
    })();
    expect((err as { code?: string }).code).toBe("PROVIDER_TRANSPORT_FAILED");
    expect((err as Error).message).toContain("Password authentication is not supported");
  });

  it("refuses a missing identity file", () => {
    const err = (() => {
      try {
        validateMacosSsh({ user: "vm", identityFile: join(root, "absent-key") });
      } catch (e) {
        return e;
      }
    })();
    expect((err as Error).message).toContain("identity file not found");
  });

  it("accepts a present identity file", () => {
    const key = join(root, "id_ed25519");
    writeFileSync(key, "fake");
    expect(() => validateMacosSsh({ user: "vm", identityFile: key })).not.toThrow();
  });

  it("refuses RAM below the macOS floor", () => {
    const err = (() => {
      try {
        validateMacosResources({
          source: { kind: "prepared-bundle", path: "/x" },
          ssh: { user: "u", identityFile: "/k" },
          memoryMib: 512,
        });
      } catch (e) {
        return e;
      }
    })();
    expect((err as Error).message).toContain("2048");
  });

  it("defaults RAM and vCPUs", () => {
    expect(
      validateMacosResources({
        source: { kind: "prepared-bundle", path: "/x" },
        ssh: { user: "u", identityFile: "/k" },
      }),
    ).toEqual({ memoryMib: 4096, cpuCount: 4 });
  });
});

describe("runner status and readiness", () => {
  it("returns undefined for a missing status file", () => {
    expect(readRunnerStatus(join(root, "absent.json"))).toBeUndefined();
  });

  it("returns undefined for a partially written file", () => {
    const path = join(root, "status.json");
    writeFileSync(path, "{");
    expect(readRunnerStatus(path)).toBeUndefined();
  });

  it("parses a running status with an address", () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "running", address: "192.168.64.4" }));
    expect(readRunnerStatus(path)).toEqual({ state: "running", address: "192.168.64.4" });
  });

  it("rejects an unknown state", () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "exploded" }));
    expect(readRunnerStatus(path)).toBeUndefined();
  });

  it("resolves readiness once the runner reports running", async () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "running", address: "10.0.0.2" }));
    const status = await waitForRunnerRunning({
      statusPath: path,
      timeoutMs: 1000,
      isAlive: () => true,
    });
    expect(status.state).toBe("running");
    expect(status.address).toBe("10.0.0.2");
  });

  it("fails readiness on a failed status", async () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "failed", error: "no such bundle" }));
    const err = await waitForRunnerRunning({
      statusPath: path,
      timeoutMs: 1000,
      isAlive: () => true,
    }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("PROVIDER_READINESS_FAILED");
    expect((err as Error).message).toContain("no such bundle");
  });

  it("fails readiness when the runner dies first", async () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "starting" }));
    const err = await waitForRunnerRunning({
      statusPath: path,
      timeoutMs: 1000,
      isAlive: () => false,
    }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("PROVIDER_READINESS_FAILED");
    expect((err as Error).message).toContain("exited before reporting readiness");
  });

  it("times out rather than reporting a false ready", async () => {
    const path = join(root, "status.json");
    writeFileSync(path, JSON.stringify({ state: "starting" }));
    const err = await waitForRunnerRunning({
      statusPath: path,
      timeoutMs: 120,
      pollMs: 20,
      isAlive: () => true,
    }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("PROVIDER_READINESS_FAILED");
    expect((err as Error).message).toContain("did not reach readiness");
  });
});
