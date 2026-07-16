import { describe, expect, it, vi } from "vitest";

import type { VmHandle } from "../vm-handle.ts";
import { withGuestShutdown } from "../vm/guest-shutdown.ts";
import { withBatchLiveMountSync } from "../vm/live-mount-batch.ts";

function fakeHandle(input: { wait?: VmHandle["wait"]; kill?: VmHandle["kill"] }): VmHandle {
  return {
    wait: input.wait ?? (async () => ({ code: 0, signal: null })),
    kill: input.kill ?? (async () => {}),
  } as VmHandle;
}

describe("guest-requested shutdown", () => {
  it("waits for guest cleanup instead of force-killing the VMM", async () => {
    const forceKill = vi.fn(async () => {});
    const wait = vi.fn(async () => ({ code: 0, signal: null }));
    const execRaw = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const handle = withGuestShutdown(fakeHandle({ wait, kill: forceKill }), execRaw);

    await handle.kill();

    expect(execRaw).toHaveBeenCalledWith(
      expect.stringContaining("kill -TERM 1"),
      expect.objectContaining({ execTimeoutMs: 2_000 }),
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(forceKill).not.toHaveBeenCalled();
  });

  it("uses the wrapped host fallback when the guest rejects shutdown", async () => {
    const forceKill = vi.fn(async () => {});
    const wait = vi.fn(async () => ({ code: 0, signal: null }));
    const execRaw = vi.fn(async () => ({ exitCode: 127, stdout: "", stderr: "" }));
    const handle = withGuestShutdown(fakeHandle({ wait, kill: forceKill }), execRaw);

    await handle.kill();

    expect(wait).not.toHaveBeenCalled();
    expect(forceKill).toHaveBeenCalledOnce();
  });

  it("does not publish a racy sync before the force-kill fallback", async () => {
    const forceKill = vi.fn(async () => {});
    const execRaw = vi.fn(async () => ({ exitCode: 127, stdout: "", stderr: "" }));
    const base = { ...fakeHandle({ kill: forceKill }), execRaw } as VmHandle;
    const handle = withBatchLiveMountSync(base, [{ host: "/host", guest: "/guest", mode: "rw" }]);

    await handle.kill();

    expect(execRaw).toHaveBeenCalledOnce();
    expect(execRaw).toHaveBeenCalledWith(
      expect.stringContaining("kill -TERM 1"),
      expect.any(Object),
    );
    expect(forceKill).toHaveBeenCalledOnce();
  });

  it("force-kills after the guest shutdown grace period", async () => {
    const forceKill = vi.fn(async () => {});
    const execRaw = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const handle = withGuestShutdown(
      fakeHandle({ wait: () => new Promise(() => {}), kill: forceKill }),
      execRaw,
      { graceMs: 5 },
    );

    await handle.kill();

    expect(forceKill).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent shutdown requests", async () => {
    const execRaw = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const handle = withGuestShutdown(fakeHandle({}), execRaw);

    await Promise.all([handle.kill(), handle.kill()]);

    expect(execRaw).toHaveBeenCalledOnce();
  });
});
