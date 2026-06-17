import { statSync } from "node:fs";

import { SnapshotError } from "../errors.ts";

const VMSTATE_FILE_POLL_MS = 10;

interface VmstateFileWaitStats {
  pollSleepMs: number;
  detectLatencyMs: number;
}

// Poll for the VMM's atomically-written `.vmstate` to (re)appear. The
// VMM writes `<path>.tmp` then rename()s it onto `<path>`, so the file
// existing with a non-zero size means the dump is complete.
export async function waitForVmstateFile(
  path: string,
  deadlineMs: number,
): Promise<VmstateFileWaitStats> {
  const deadline = Date.now() + deadlineMs;
  let pollSleepMs = 0;
  while (Date.now() < deadline) {
    try {
      const st = statSync(path);
      if (st.size > 0) {
        return {
          pollSleepMs,
          detectLatencyMs: Math.max(0, Date.now() - st.mtimeMs),
        };
      }
    } catch {
      // ENOENT — not written yet.
    }
    const sleepMs = Math.min(VMSTATE_FILE_POLL_MS, Math.max(0, deadline - Date.now()));
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
      pollSleepMs += sleepMs;
    }
  }
  throw new SnapshotError(
    "SNAPSHOT_TIMEOUT",
    `vm.snapshot: the VMM did not write its .vmstate within ${deadlineMs}ms (${path}).\n` +
      `  The VM may not have been booted with MACHINEN_SNAPSHOT_ENGINE=vmstate.`,
  );
}
