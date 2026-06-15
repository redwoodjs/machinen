import { rmSync, unlinkSync } from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import debugLib from "debug";
import { removeCpuCgroup } from "../cpu-cgroup.ts";
import { removeEntry } from "../registry.ts";

const debug = debugLib("machinen:boot");

interface ExitCleanupState {
  child: ChildProcessWithoutNullStreams;
  childPid: number;
  bootT0: number;
  perBootRootDisk: string | undefined;
  perBootSnapDisk: string | undefined;
  perBootMountUpper: string | undefined;
  bundleTempDir: string | undefined;
  vsockTempDir: string | undefined;
  statsTempDir: string | undefined;
  cpuCgroupPath: string | undefined;
  gvStop: (() => void) | undefined;
  registered: boolean;
}

// On VMM exit, reap every per-boot artifact:
//   - reflink copies (#121, #272) so guest writes don't persist;
//   - bundle/vsock/stats temp dirs;
//   - CPU cgroups;
//   - the gvproxy child;
//   - the registry entry.
// All best-effort: a clean exit, signal exit, and kernel panic all
// land here, and the cached `<sha>.img` template is kept clean inline
// at copy time, so nothing here depends on graceful exit.
export function installVmExitCleanup(state: ExitCleanupState): void {
  state.child.once("exit", (code, signal) => {
    debug(
      "VMM exit pid=%d code=%s signal=%s lifetimeMs=%d",
      state.childPid,
      code,
      signal,
      Date.now() - state.bootT0,
    );
    for (const file of [state.perBootRootDisk, state.perBootSnapDisk, state.perBootMountUpper]) {
      if (file) {
        try {
          unlinkSync(file);
        } catch {}
      }
    }
    for (const dir of [state.bundleTempDir, state.vsockTempDir, state.statsTempDir]) {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    }
    removeCpuCgroup(state.cpuCgroupPath);
    if (state.gvStop) {
      state.gvStop();
    }
    if (state.registered) {
      removeEntry(state.childPid);
    }
  });
}
