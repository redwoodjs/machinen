import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execSyncMock = vi.fn((cmd) => {
  if (cmd.includes("gh api user")) {
    return "testuser\n";
  }
  if (cmd.includes("gh auth token")) {
    return "gho_testtoken123\n";
  }
  if (cmd.includes("gh auth status")) {
    return "  - Token scopes: 'repo', 'write:packages'\n";
  }
  return "";
});

const execFileSyncMock = vi.fn(() => "");

vi.mock("node:child_process", () => ({
  execSync: (...args: any[]) => (execSyncMock as any)(...args),
  execFileSync: (...args: any[]) => (execFileSyncMock as any)(...args),
}));

describe("registry", () => {
  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockClear();
    execFileSyncMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getRegistry returns ghcr.io URL with username", async () => {
    const { getRegistry } = await import("../registry");
    const reg = getRegistry();
    expect(reg.url).toBe("ghcr.io/testuser");
    expect(reg.username).toBe("testuser");
    expect(reg.token).toBe("gho_testtoken123");
  });

  it("ensureDockerLogin calls docker login with gh token", async () => {
    const { ensureDockerLogin } = await import("../registry");
    ensureDockerLogin();
    const loginCall: any = execFileSyncMock.mock.calls.find(
      (c: any) => c[0] === "docker" && c[1].includes("login"),
    );
    expect(loginCall).toBeTruthy();
    expect(loginCall[1]).toContain("ghcr.io");
    expect(loginCall[1]).toContain("testuser");
    expect(loginCall[2].input).toBe("gho_testtoken123");
  });

  it("remoteDockerLogin calls ssh with docker login", async () => {
    const { remoteDockerLogin } = await import("../registry");
    const mockSsh = vi.fn();
    remoteDockerLogin(mockSsh, "1.2.3.4");
    expect(mockSsh).toHaveBeenCalledWith(
      "1.2.3.4",
      expect.stringContaining("docker login ghcr.io"),
      expect.any(Object),
    );
  });
});
