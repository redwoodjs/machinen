import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForVmstateFile } from "../vm/vmstate-wait.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vmstate-wait-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("waitForVmstateFile", () => {
  it("returns wait stats once the state file appears", async () => {
    const path = join(dir, "state.vmstate");
    const wait = waitForVmstateFile(path, 1_000);
    setTimeout(() => writeFileSync(path, "state"), 25);

    const stats = await wait;

    expect(stats.pollSleepMs).toBeGreaterThanOrEqual(10);
    expect(stats.detectLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("times out when the state file never appears", async () => {
    await expect(waitForVmstateFile(join(dir, "missing.vmstate"), 20)).rejects.toThrow(
      /did not write its \.vmstate/,
    );
  });
});
