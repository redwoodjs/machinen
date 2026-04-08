import { dockerExec, prepareCheckpoint, buildCheckpointImage, pushImage } from "./docker.mjs";
import { ssh } from "./cloud.mjs";
import fs from "node:fs";

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

function isAuthError(msg) {
  return /write:packages|unauthorized|authentication required|no basic auth credentials|requested access to the resource is denied|denied:|not authorized|not authorised|access denied|401\b|403\b/i.test(
    msg,
  );
}

export function startBackgroundSync(containerName, registry, ip) {
  let running = true;
  let timer;

  async function sync() {
    if (!running) {
      return;
    }
    try {
      console.log("[sync] Preparing checkpoint...");
      const { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath } =
        await prepareCheckpoint(containerName, { stop: false });

      try {
        const tag = `${registry}/${containerName}:${checkpointId}`;
        const latestTag = `${registry}/${containerName}:latest`;
        const baseTag = `${registry}/${containerName}:base-${checkpointId}`;
        const baseLatestTag = `${registry}/${containerName}:base`;

        // Push the committed image as the base — restore needs identical layers
        dockerExec(["tag", commitImage, baseTag]);
        dockerExec(["tag", commitImage, baseLatestTag]);
        pushImage(baseTag);
        pushImage(baseLatestTag);

        buildCheckpointImage(
          tarPath,
          commitImage,
          config,
          checkpointId,
          tag,
          [],
          baseLatestTag,
          containerId,
        );
        dockerExec(["tag", tag, latestTag]);

        pushImage(tag);
        pushImage(latestTag);

        // Pre-pull on remote
        if (ip) {
          console.log("[sync] Pre-pulling on remote...");
          ssh(ip, `docker pull ${latestTag}`, { stdio: "pipe" });
        }

        console.log(`[sync] Synced: ${checkpointId}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        try {
          dockerExec(["rm", "-f", cleanName]);
        } catch {}
        try {
          dockerExec(["rmi", commitImage]);
        } catch {}
      }
    } catch (err) {
      console.error("[sync] Failed:", err.message);
      if (isAuthError(err.message)) {
        console.error(
          "[sync] This looks like an auth error. Try: gh auth refresh -s write:packages",
        );
      }
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
      if (timer) {
        clearTimeout(timer);
      }
    },
    // Force an immediate sync (used before sleep)
    syncNow: sync,
  };
}
