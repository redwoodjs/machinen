import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execSyncMock = vi.fn((cmd) => {
  if (cmd.includes("gh api user")) return "testuser\n";
  if (cmd.includes("gh auth token")) return "gho_testtoken123\n";
  if (cmd.includes("gh auth status")) return "  - Token scopes: 'repo', 'write:packages'\n";
  if (cmd.includes("docker login")) return "";
  return "";
});

vi.mock("node:child_process", () => ({
  execSync: (...args) => execSyncMock(...args),
}));

describe("registry", () => {
  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getRegistry returns ghcr.io URL with username", async () => {
    const { getRegistry } = await import("../registry.mjs");
    const reg = getRegistry();
    expect(reg.url).toBe("ghcr.io/testuser");
    expect(reg.username).toBe("testuser");
    expect(reg.token).toBe("gho_testtoken123");
  });

  it("ensureDockerLogin calls docker login with gh token", async () => {
    const { ensureDockerLogin } = await import("../registry.mjs");
    ensureDockerLogin();
    const loginCall = execSyncMock.mock.calls.find((c) =>
      c[0].includes("docker login")
    );
    expect(loginCall).toBeTruthy();
    expect(loginCall[0]).toContain("ghcr.io");
    expect(loginCall[0]).toContain("testuser");
  });

  it("remoteDockerLogin calls ssh with docker login", async () => {
    const { remoteDockerLogin } = await import("../registry.mjs");
    const mockSsh = vi.fn();
    remoteDockerLogin(mockSsh, "1.2.3.4");
    expect(mockSsh).toHaveBeenCalledWith(
      "1.2.3.4",
      expect.stringContaining("docker login ghcr.io"),
      expect.any(Object)
    );
  });
});
