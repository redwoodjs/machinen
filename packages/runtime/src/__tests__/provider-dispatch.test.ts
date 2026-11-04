// Provider dispatch. The load-bearing assertion is that selecting a macOS
// guest never reaches Linux asset resolution, because swapping only the
// VMM binary would still demand a kernel, DTB, and rootfs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveBaseKernel = vi.fn(() => {
  throw new Error("resolveBaseKernel must not run for a macOS guest");
});
const resolveBaseDtb = vi.fn(() => {
  throw new Error("resolveBaseDtb must not run for a macOS guest");
});
const resolveBaseRootfs = vi.fn(() => {
  throw new Error("resolveBaseRootfs must not run for a macOS guest");
});

vi.mock("../base-assets.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../base-assets.ts")>();
  return { ...actual, resolveBaseKernel, resolveBaseDtb, resolveBaseRootfs };
});

const { boot } = await import("../vm/boot.ts");
const { restore } = await import("../vm/restore.ts");
const { performSnapshot } = await import("../vm/snapshot.ts");
const { performFork } = await import("../vm/fork.ts");
const { resolveGuestOS, resolveProviderId, selectProvider } = await import("../provider/select.ts");
const { BootError } = await import("../errors.ts");

function expectCode(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(BootError);
  expect((err as { code?: string }).code).toBe(code);
}

describe("provider selection", () => {
  it("defaults to linux when nothing is configured", () => {
    expect(resolveGuestOS(undefined)).toBe("linux");
    expect(resolveGuestOS("")).toBe("linux");
    expect(selectProvider({})).toEqual({
      guestOS: "linux",
      provider: process.platform === "darwin" ? "machinen-hvf" : "machinen-kvm",
    });
  });

  it("selects apple-vz for a macOS guest", () => {
    expect(selectProvider({ guestOS: "macos" })).toEqual({
      guestOS: "macos",
      provider: "apple-vz",
    });
  });

  it("rejects an unknown guest OS by name", () => {
    const err = (() => {
      try {
        resolveGuestOS("plan9");
      } catch (e) {
        return e;
      }
    })();
    expectCode(err, "PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("plan9");
  });

  it("rejects an unknown provider by name", () => {
    const err = (() => {
      try {
        resolveProviderId("linux", "lume");
      } catch (e) {
        return e;
      }
    })();
    expectCode(err, "PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("lume");
  });
});

describe("early dispatch", () => {
  beforeEach(() => {
    resolveBaseKernel.mockClear();
    resolveBaseDtb.mockClear();
    resolveBaseRootfs.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never resolves Linux kernel or DTB assets for a macOS boot", async () => {
    // The load-bearing invariant is the ordering, not which provider error
    // fires: a macOS boot must not reach asset resolution on any host.
    const err = await boot({ guestOS: "macos" }).catch((e) => e);
    expect((err as { code?: string }).code).toMatch(/^PROVIDER_/);
    expect(resolveBaseKernel).not.toHaveBeenCalled();
    expect(resolveBaseDtb).not.toHaveBeenCalled();
    expect(resolveBaseRootfs).not.toHaveBeenCalled();
  });

  it("names the host when macOS guests are requested off Apple silicon", async () => {
    if (process.platform === "darwin" && process.arch === "arm64") {
      // Covered by the option-rejection and bundle-validation cases below.
      return;
    }
    const err = await boot({ guestOS: "macos" }).catch((e) => e);
    expectCode(err, "PROVIDER_HOST_UNSUPPORTED");
  });

  it("refuses a macOS boot without a macos configuration block", async () => {
    const err = await boot({ guestOS: "macos" }).catch((e) => e);
    expect((err as Error).message).toContain("macos");
  });

  it("refuses Linux-only boot options for a macOS guest", async () => {
    const err = await boot({
      guestOS: "macos",
      snapshot: "/tmp/scratch",
      macos: {
        source: { kind: "prepared-bundle", path: "/nonexistent" },
        ssh: { user: "vm", identityFile: "/nonexistent/key" },
      },
    }).catch((e) => e);
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      // Host validation runs first and is the correct answer off-arm64.
      expectCode(err, "PROVIDER_HOST_UNSUPPORTED");
      return;
    }
    expectCode(err, "PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("snapshot");
  });

  it("refuses restore for a macOS guest independently of boot", async () => {
    const err = await restore({ snapDir: "/tmp/whatever", guestOS: "macos" }).catch((e) => e);
    expectCode(err, "PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("restore");
  });

  it("refuses snapshot for a macOS guest", async () => {
    const err = await performSnapshot(
      {
        pid: 1,
        guestOS: "macos",
        diskPath: "/tmp/scratch",
        execRaw: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        wait: async () => ({ code: 0, signal: null }),
        kill: async () => {},
        teeGuestConsole: undefined,
        errorOutput: async () => "",
      },
      { outDir: "/tmp/out" },
    ).catch((e) => e);
    expect((err as { code?: string }).code).toBe("PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("snapshot");
  });

  it("refuses fork for a macOS guest", () => {
    const err = (() => {
      try {
        void performFork(
          {
            pid: 1,
            guestOS: "macos",
            diskPath: "/tmp/scratch",
            execRaw: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
            wait: async () => ({ code: 0, signal: null }),
            kill: async () => {},
            teeGuestConsole: undefined,
            errorOutput: async () => "",
          },
          {},
        );
      } catch (e) {
        return e;
      }
    })();
    expect((err as { code?: string }).code).toBe("PROVIDER_UNSUPPORTED_OPERATION");
    expect((err as Error).message).toContain("fork");
  });

  it("still boots Linux with the unchanged default path", async () => {
    const err = await boot({ image: "/nonexistent/rootfs.tar.gz", cmd: ["/bin/true"] }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).not.toBe("PROVIDER_UNSUPPORTED_OPERATION");
  });
});
