import { describe, it, expect, vi, afterEach } from "vitest";

describe("startBackgroundSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can be stopped before first sync fires", async () => {
    // Mock the imports so we don't actually hit Docker
    vi.mock("../docker", () => ({
      dockerExec: vi.fn(),
      prepareCheckpoint: vi.fn(),
      buildCheckpointImage: vi.fn(),
      pushImage: vi.fn(),
    }));
    vi.mock("../cloud", () => ({
      ssh: vi.fn(),
    }));

    const { startBackgroundSync } = await import("../sync");
    const syncer = startBackgroundSync("test-container", "registry.example.com", "1.2.3.4");

    // Stop immediately — should not throw
    syncer.stop();
  });
});
