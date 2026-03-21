import {
  createCheckpoint,
  extractCheckpointFiles,
  buildCheckpointImage,
  pushImage,
} from "./docker.mjs";
import { ssh, saveState } from "./hetzner.mjs";
import fs from "node:fs";

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function startBackgroundSync(containerName, registry, ip) {
  let running = true;
  let timer;

  async function sync() {
    if (!running) return;
    try {
      console.log("[sync] Creating non-destructive checkpoint...");
      const { containerId, checkpointId, config } = await createCheckpoint(containerName, { exit: false });

      console.log("[sync] Extracting checkpoint files...");
      const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

      try {
        const tag = `${registry}/${containerName}:${checkpointId}`;
        const latestTag = `${registry}/${containerName}:latest`;

        buildCheckpointImage(tarPath, config.Image, config, checkpointId, tag);

        const { execSync } = await import("node:child_process");
        execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });

        pushImage(tag);
        pushImage(latestTag);

        // Pre-pull on remote
        if (ip) {
          console.log("[sync] Pre-pulling on remote...");
          ssh(ip, `docker pull ${latestTag}`, { stdio: "pipe" });
        }

        saveState(containerName, { tag, latestTag, checkpointId, registry });
        console.log(`[sync] Synced: ${checkpointId}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error("[sync] Failed:", err.message);
    }

    if (running) {
      timer = setTimeout(sync, SYNC_INTERVAL);
    }
  }

  // Start first sync after a delay (let user get settled)
  timer = setTimeout(sync, 30 * 1000);

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    // Force an immediate sync (used before sleep)
    syncNow: sync,
  };
}
