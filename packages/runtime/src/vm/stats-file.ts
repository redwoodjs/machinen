import { closeSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STATS_FILE_SIZE } from "../balloon-stats.ts";

// #274: shared stats file the balloon backend writes counters to.
// Pre-allocated zero-filled here so the VMM's mmap'd writer and our
// host-side reader see a coherent layout before the first reporting chain.
export function setupStatsFile(
  env: Record<string, string>,
  vsockTempDir: string | undefined,
): { statsFilePath: string | undefined; statsTempDir: string | undefined } {
  if (env.MACHINEN_STATS_FILE !== undefined) {
    return { statsFilePath: env.MACHINEN_STATS_FILE, statsTempDir: undefined };
  }
  let statsTempDir: string | undefined;
  const statsFileTempDir =
    vsockTempDir ?? (statsTempDir = mkdtempSync(join(tmpdir(), "machinen-stats-")));
  const statsFilePath = join(statsFileTempDir, "stats.bin");
  const fd = openSync(statsFilePath, "w");
  try {
    writeSync(fd, Buffer.alloc(STATS_FILE_SIZE), 0, STATS_FILE_SIZE, 0);
  } finally {
    closeSync(fd);
  }
  env.MACHINEN_STATS_FILE = statsFilePath;
  return { statsFilePath, statsTempDir };
}
