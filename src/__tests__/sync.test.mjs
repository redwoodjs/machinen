import { describe, it, expect, vi, afterEach } from "vitest";

describe("startBackgroundSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("can be stopped before first sync fires", async () => {
    // Mock the imports so we don't actually hit Docker
    vi.mock("../docker.mjs", () => ({
      createCheckpoint: vi.fn(),
      extractCheckpointFiles: vi.fn(),
      buildCheckpointImage: vi.fn(),
      pushImage: vi.fn(),
    }));
    vi.mock("../hetzner.mjs", () => ({
      ssh: vi.fn(),
      loadState: vi.fn(() => ({})),
      saveState: vi.fn(),
    }));

    const { startBackgroundSync } = await import("../sync.mjs");
    const syncer = startBackgroundSync("test-container", "registry.example.com", "1.2.3.4");

    // Stop immediately — should not throw
    syncer.stop();
  });
});
