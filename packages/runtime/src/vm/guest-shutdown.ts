import type { VmHandle } from "../vm-handle.ts";

const GUEST_SHUTDOWN_COMMAND =
  "if [ -e /run/machinen-supervisor.ready ]; then kill -TERM 1; else /sbin/machinen-poweroff; fi";
const DEFAULT_GUEST_SHUTDOWN_GRACE_MS = 30_000;

interface GuestShutdownOptions {
  graceMs?: number;
}

/**
 * Ask PID 1 to stop the workload and run guest-owned cleanup before using the
 * wrapped handle's force-kill path.
 */
export function withGuestShutdown(
  handle: VmHandle,
  requestExecRaw: VmHandle["execRaw"],
  opts: GuestShutdownOptions = {},
): VmHandle {
  let shutdown: Promise<void> | undefined;
  return {
    ...handle,
    kill: () => {
      shutdown ??= shutdownGuest(handle, requestExecRaw, opts.graceMs);
      return shutdown;
    },
  };
}

async function shutdownGuest(
  handle: VmHandle,
  requestExecRaw: VmHandle["execRaw"],
  graceMs = DEFAULT_GUEST_SHUTDOWN_GRACE_MS,
): Promise<void> {
  const requested = await requestGuestShutdown(requestExecRaw);
  if (requested && (await waitForGuestPoweroff(handle.wait, graceMs))) {
    return;
  }
  await handle.kill();
}

async function requestGuestShutdown(execRaw: VmHandle["execRaw"]): Promise<boolean> {
  try {
    const result = await execRaw(GUEST_SHUTDOWN_COMMAND, {
      connectTimeoutMs: 1_000,
      execTimeoutMs: 2_000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function waitForGuestPoweroff(wait: VmHandle["wait"], graceMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      wait().then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
