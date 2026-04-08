import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getProvider } from "./cloud.mjs";
import { ensureDiND, getDiNDHost, dindExec } from "./dind.mjs";
import { reconnectDocker, docker, createCheckpoint } from "./docker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(__dirname, "..", "scripts");

const CTR = "ctr --address /run/docker/containerd/containerd.sock --namespace moby";

/**
 * Remove all checkpoint/* images AND their orphaned content blobs from
 * containerd.  docker system prune doesn't know about checkpoint images
 * that docker start --checkpoint commits to containerd, so they accumulate
 * on the persistent machinen-docker-data volume across runs.  We delete
 * the blobs directly rather than waiting for async GC.
 * Safe to call only after docker system prune -af (no running containers).
 */
function pruneContainerdCheckpoints() {
  try {
    // Delete checkpoint image references.
    dindExec(
      `${CTR} images ls -q 2>/dev/null | grep '^checkpoint/' | ` +
      `xargs -r sh -c 'for img; do ${CTR} images delete "$img" 2>/dev/null; done' _ || true`,
    );
    // Directly remove all content blobs.  After docker system prune -af no
    // running containers reference these, so it is safe to wipe them.
    // docker pull below will repopulate whatever the test actually needs.
    dindExec(
      `${CTR} content ls -q 2>/dev/null | ` +
      `xargs -r sh -c 'for blob; do ${CTR} content rm "$blob" 2>/dev/null; done' _ || true`,
    );
  } catch {}
}

// Test that docker checkpoint create + restore works against the DiND inner
// daemon.  We:
//   1. Checkpoint a container with a tmux session — the CRIU patch is
//      required for PTY sessions (removes the tty_verify_ctty check).
//   2. Restore the SAME container.
//
// We restore the same container (not a new one) to avoid the PTY file
// descriptor re-attachment issue that occurs when restoring tmux into a
// container with a different mount namespace layout.  Reliable same-container
// restore is achieved by cleaning the containerd content store before
// docker start --checkpoint — otherwise the checkpoint blobs written by the
// API checkpoint call conflict with the ones docker start tries to commit.
const PREFLIGHT_IMAGE = "machinen-preflight";

async function ensurePreflightImage() {
  try {
    execSync(`docker image inspect ${PREFLIGHT_IMAGE}`, { stdio: "pipe" });
    return;
  } catch {}
  execSync("docker pull alpine", { stdio: "pipe" });
  execSync(
    `docker build -t ${PREFLIGHT_IMAGE} -`,
    { stdio: "pipe", input: `FROM alpine\nRUN apk add -q --no-cache tmux\n` },
  );
}

async function testCheckpointWorks(docker) {
  const testName = "criu-preflight-test";

  // Clean up leftover containers and stale containerd checkpoint blobs.
  // No full image prune here — checkPrerequisites handles that on --clean,
  // and keeping cached images makes subsequent runs fast.
  try { await docker.getContainer(testName).remove({ force: true }); } catch {}
  pruneContainerdCheckpoints();

  let container;
  let checkpointId;

  try {
    await ensurePreflightImage();

    // Test with tmux — the patched CRIU is required to checkpoint containers
    // with PTY sessions (removes the tty_verify_ctty pid_real check).
    container = await docker.createContainer({
      Image: PREFLIGHT_IMAGE,
      name: testName,
      Cmd: ["sh", "-c", "tmux new-session -d -s test; exec sleep 300"],
      // NetworkMode "host" avoids the per-container netns bind-mount that
      // CRIU cannot restore before the process starts.
      HostConfig: { SecurityOpt: ["seccomp=unconfined"], NetworkMode: "host" },
    });
    await container.start();

    // Wait for setup to complete: once `exec sleep 300` runs, the shell has
    // been replaced and there are no lingering TCP sockets.
    const setupDeadline = Date.now() + 30_000;
    while (Date.now() < setupDeadline) {
      try {
        const top = execSync(`docker exec ${testName} ps -o comm= -p 1`, { stdio: "pipe", encoding: "utf-8" }).trim();
        if (top === "sleep") break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }

    // Use the Docker API (not CLI) to create the checkpoint.  The API stores
    // files at /var/lib/docker/containers/<id>/checkpoints/<cpId>/ inside DiND
    // and also commits checkpoint blobs to containerd.  We purge those blobs
    // immediately so that docker start --checkpoint can commit them fresh
    // without hitting "content sha256:...: already exists".
    const { checkpointId: cpId } = await createCheckpoint(testName, { exit: true });
    checkpointId = cpId;

    pruneContainerdCheckpoints();

    // Restore the same container from its checkpoint.
    execSync(`docker start --checkpoint ${checkpointId} ${testName}`, { stdio: "pipe" });

    return true;
  } catch (err) {
    console.error("Checkpoint test failed:", err.message || err);
    return false;
  } finally {
    try { await container?.stop(); } catch {}
    try { await container?.remove({ force: true }); } catch {}
    // Clean up the checkpoint image committed to containerd by docker start
    // --checkpoint so subsequent runs don't hit "content sha256:...: already exists".
    if (checkpointId) {
      try { dindExec(`${CTR} images delete "checkpoint/${testName}/${checkpointId}" 2>/dev/null || true`); } catch {}
    }
  }
}

export async function checkPrerequisites(_docker, opts = {}) {
  getProvider().checkAuth();

  if (opts.clean) {
    // Force a full rebuild of the DiND image on --clean.
    console.log("Rebuilding machinen-dind (--clean)...");
    const hostEnv = { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" };
    try { execSync(`docker rm -f machinen-dind`, { stdio: "pipe", env: hostEnv }); } catch {}
    try { execSync(`docker rmi -f machinen-dind`, { stdio: "pipe", env: hostEnv }); } catch {}
  }

  await ensureDiND(scriptsDir);
  const diNDHost = getDiNDHost(); // tcp://<bridge-ip>:2375
  process.env.DOCKER_HOST = diNDHost;
  const { hostname, port } = new URL(diNDHost);
  reconnectDocker(hostname, parseInt(port, 10));
  // `docker` is a live ESM binding — it now points to the DiND inner daemon.

  console.log("Testing if docker checkpoint works...");
  if (!(await testCheckpointWorks(docker))) {
    throw new Error("CRIU is not working inside machinen-dind. Try running with --clean to rebuild the image.");
  }
  console.log("CRIU is available.");
}
