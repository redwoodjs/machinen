import { closeSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planBootStatsFileNative } from "../native/boot-plan.ts";
import { planBootStatsFileTempModeNative } from "../native/stats-file-mode.ts";

// #274: shared stats file the balloon backend writes counters to.
// Pre-allocated zero-filled here so the VMM's mmap'd writer and our
// host-side reader see a coherent layout before the first reporting chain.
export function setupStatsFile(
  env: Record<string, string>,
  vsockTempDir: string | undefined,
): { statsFilePath: string | undefined; statsTempDir: string | undefined } {
  const mode = planBootStatsFileTempModeNative({
    existingPath: env.MACHINEN_STATS_FILE,
    vsockTempDir,
  });
  if (mode.action === "existing") {
    return { statsFilePath: mode.existingPath ?? undefined, statsTempDir: undefined };
  }
  let statsTempDir: string | undefined;
  const statsFileTempDir =
    mode.tempDir ?? (statsTempDir = mkdtempSync(join(tmpdir(), "machinen-stats-")));
  const plan = planBootStatsFileNative({ tempDir: statsFileTempDir });
  if (!plan.statsFilePath) {
    return { statsFilePath: undefined, statsTempDir };
  }
  const fd = openSync(plan.statsFilePath, "w");
  try {
    writeSync(fd, Buffer.alloc(16), 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (plan.vmmStatsFile) {
    env.MACHINEN_STATS_FILE = plan.vmmStatsFile;
  }
  return { statsFilePath: plan.statsFilePath, statsTempDir };
}
