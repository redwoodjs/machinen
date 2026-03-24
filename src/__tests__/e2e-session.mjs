#!/usr/bin/env node

/**
 * E2E test: shell sessions survive freeze/restore via socat
 *
 * Verifies that processes started through a socat session socket (child of
 * PID 1) persist across a CRIU checkpoint/restore cycle.  This is the fix
 * for issue #18: plain `docker exec` sessions are outside PID 1's tree and
 * silently disappear on restore.
 *
 * The approach: PID 1 starts a socat listener on a Unix socket.  Each
 * `machinen open` connection forks a shell that is a child of PID 1's
 * process tree.  Background processes started in that shell survive CRIU.
 *
 * Requires: Docker with experimental mode, CRIU, local registry on :5000
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docker,
  captureContainerConfig,
  createCheckpoint,
  extractCheckpointFiles,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
  hasSessionSocket,
} from "../docker.mjs";

const REGISTRY = "localhost:5000";
const CONTAINER = "machinen-e2e-session";
const RESTORED = `${CONTAINER}-restored`;
const CLEAN = `${CONTAINER}-clean`;
const COMMITTED = `${CONTAINER}-committed`;

// --- helpers ---

function exec(cmd) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf-8" }).trim();
}

function dockerExec(container, cmd) {
  return exec(`docker exec ${container} ${cmd}`);
}

function rmContainer(name) {
  try { exec(`docker rm -f ${name}`); } catch {}
}

function assert(ok, msg) {
  if (!ok) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function cleanup() {
  for (const c of [CONTAINER, RESTORED, CLEAN, COMMITTED, "machinen-tmp"]) {
    rmContainer(c);
  }
  for (const pattern of [`${REGISTRY}/*`, `${COMMITTED}`]) {
    try { exec(`docker images --format '{{.Repository}}:{{.Tag}}' ${pattern} | xargs -r docker rmi -f`); } catch {}
  }
}

// --- main ---

async function main() {
  cleanup();

  try {
    // ── 1. Create container with socat session socket ──────────────────
    console.log("1. Creating container with session socket...");

    // The entrypoint installs socat, starts a listener on a Unix socket
    // (child of PID 1's sh), then execs sleep infinity.
    // This mirrors what `machinen up --image` will do.
    const script = 'apk add --no-cache socat >/dev/null 2>&1; socat UNIX-LISTEN:/tmp/machinen.sock,fork,reuseaddr EXEC:/bin/sh,sigint,sighup,sigquit & exec sleep infinity';

    execFileSync("docker", [
      "run", "-d",
      "--name", CONTAINER,
      "--security-opt", "seccomp=unconfined",
      "--network", "host",
      "alpine", "sh", "-c", script,
    ], { stdio: "pipe" });

    // Let socat start
    await new Promise(r => setTimeout(r, 3000));

    // Check if socat was installed successfully
    try {
      dockerExec(CONTAINER, "which socat");
      console.log("   socat installed");
    } catch {
      console.log("   socat not installed — checking container logs:");
      try { console.log(exec(`docker logs ${CONTAINER} 2>&1`)); } catch {}
    }

    // Verify session socket exists
    const hasSock = hasSessionSocket(CONTAINER);
    assert(hasSock, "session socket /tmp/machinen.sock not found");
    console.log("   session socket active");

    // ── 2. Start background processes via the session socket ───────────
    console.log("2. Starting background processes via session socket...");

    // Connect to the socat session and start a counter loop.
    // This shell is forked by socat, making it a child of PID 1's tree.
    dockerExec(CONTAINER, `sh -c 'printf "SECRET=session-survived\\necho \\$SECRET > /tmp/proof.txt\\nCOUNTER=0; while true; do COUNTER=\\$((COUNTER+1)); echo \\$COUNTER:\\$SECRET > /tmp/state.txt; sleep 1; done &\\n" | socat - UNIX-CONNECT:/tmp/machinen.sock'`);
    await new Promise(r => setTimeout(r, 3000));

    // Verify state was written
    const preProof = dockerExec(CONTAINER, "cat /tmp/proof.txt");
    assert(preProof === "session-survived", `proof file has wrong content: ${preProof}`);
    console.log(`   proof: ${preProof}`);

    const preState = dockerExec(CONTAINER, "cat /tmp/state.txt");
    const preCounter = parseInt(preState.split(":")[0], 10);
    const preSecret = preState.split(":")[1];
    assert(preCounter > 0, `counter should be > 0, got ${preCounter}`);
    assert(preSecret === "session-survived", `secret mismatch: ${preSecret}`);
    console.log(`   counter=${preCounter}  secret=${preSecret}`);

    // Verify the socat listener is in the process tree
    const ps = dockerExec(CONTAINER, "ps aux");
    assert(ps.includes("socat UNIX-LISTEN"), "socat listener not found in process tree");
    console.log("   socat listener in PID 1 tree");

    // ── 3. Freeze (commit → checkpoint → image → push) ────────────────
    console.log("3. Freezing...");

    exec(`docker commit ${CONTAINER} ${COMMITTED}`);

    const container = docker.getContainer(CONTAINER);
    const info = await container.inspect();
    const config = captureContainerConfig(info);

    const { containerId, checkpointId } = await createCheckpoint(CONTAINER, { exit: true });
    console.log(`   checkpoint: ${checkpointId}`);

    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

    try {
      const prefix = `${REGISTRY}/machinen/${CONTAINER}`;
      const tag = `${prefix}:${checkpointId}`;
      const latestTag = `${prefix}:latest`;
      const baseTag = `${prefix}:base`;

      exec(`docker tag ${COMMITTED} ${baseTag}`);
      pushImage(baseTag);

      buildCheckpointImage(
        tarPath, COMMITTED, config, checkpointId, tag,
        /* workspaceTars */ [],
        /* baseImageTag */ baseTag,
        /* checkpointedContainerId */ containerId,
      );
      exec(`docker tag ${tag} ${latestTag}`);
      pushImage(tag);
      pushImage(latestTag);

      console.log("   frozen and pushed.");

      // ── 4. Clean local state + restore ────────────────────────────────
      console.log("4. Cleaning local state...");
      rmContainer(CLEAN);
      rmContainer(CONTAINER);
      try { exec(`docker rmi ${COMMITTED}`); } catch {}

      console.log("5. Restoring locally...");
      pullImage(latestTag);
      restoreLocally(latestTag, RESTORED);

      // Let processes resume after restore
      await new Promise(r => setTimeout(r, 3000));

      // ── 5. Verify ────────────────────────────────────────────────────
      console.log("6. Verifying...");

      // Container is running
      const status = exec(`docker inspect --format '{{.State.Status}}' ${RESTORED}`);
      assert(status === "running", `container not running (status: ${status})`);
      console.log("   [pass] container is running");

      // Proof file survived
      const postProof = dockerExec(RESTORED, "cat /tmp/proof.txt");
      assert(postProof === "session-survived", `proof file lost: ${postProof}`);
      console.log("   [pass] /tmp/proof.txt preserved");

      // Counter still ticking with in-memory secret
      const postState1 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const [counterStr1, secret1] = postState1.split(":");
      const postCounter1 = parseInt(counterStr1, 10);

      assert(secret1 === "session-survived", `in-memory SECRET lost: ${secret1}`);
      console.log("   [pass] in-memory SECRET preserved across checkpoint/restore");

      assert(postCounter1 >= preCounter, `counter regressed (pre=${preCounter} post=${postCounter1})`);
      console.log(`   [pass] counter preserved: ${postCounter1} (was ${preCounter})`);

      // Counter is still incrementing (process is alive)
      await new Promise(r => setTimeout(r, 2000));
      const postState2 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const postCounter2 = parseInt(postState2.split(":")[0], 10);

      assert(postCounter2 > postCounter1, `counter not incrementing (${postCounter1} → ${postCounter2})`);
      console.log(`   [pass] counter still incrementing: ${postCounter1} → ${postCounter2}`);

      // Session socket survived restore — socat listener is alive
      const postHasSock = hasSessionSocket(RESTORED);
      assert(postHasSock, "session socket not found after restore");
      console.log("   [pass] session socket survived restore");

      // Can connect a new session after restore
      dockerExec(RESTORED, `sh -c 'echo "echo post-restore > /tmp/post.txt" | socat - UNIX-CONNECT:/tmp/machinen.sock'`);
      await new Promise(r => setTimeout(r, 1000));
      const postCmd = dockerExec(RESTORED, "cat /tmp/post.txt");
      assert(postCmd === "post-restore", `post-restore command failed: ${postCmd}`);
      console.log("   [pass] new session connection works after restore");

      // Process tree shows socat listener
      const postPs = dockerExec(RESTORED, "ps aux");
      assert(postPs.includes("socat UNIX-LISTEN"), "socat listener not in process tree after restore");
      console.log("   [pass] socat listener in process tree");

      console.log("\nAll session e2e checks passed.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
}

main().catch(err => {
  console.error(`\nE2E FAILED: ${err.message}`);
  cleanup();
  process.exit(1);
});
