import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const assets = resolve(process.cwd(), "packages/microvm/assets");
const supervisor = join(assets, "machinen-supervisor.zig");
const restore = join(assets, "machinen-restore.sh");

describe("guest lifecycle owner", () => {
  it("passes the compiled supervisor's unit tests", () => {
    expect(() => execFileSync("zig", ["test", supervisor, "-lc"])).not.toThrow();
  });

  it("keeps restore focused on CRIU while the supervisor owns cleanup", () => {
    const script = readFileSync(restore, "utf8");

    expect(script).toContain("exec /sbin/machinen-supervisor --restore");
    expect(script).toContain("restore_forward_signal TERM");
    expect(script).not.toContain("machinen-lifecycle.sh");
    expect(script).not.toContain("machinen_poweroff_after_cleanup");
    expect(script).not.toContain("machinen_start_sidecars");
  });
});
