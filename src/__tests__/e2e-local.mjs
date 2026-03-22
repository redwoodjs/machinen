#!/usr/bin/env node

/**
 * E2E test: freeze → restore locally
 *
 * Verifies the full checkpoint/restore cycle:
 *   1. Create a container with known file and in-memory state
 *   2. Commit → clean copy → checkpoint → build image → push to local registry
 *   3. Pull from registry → restore locally
 *   4. Assert: container running, files intact, process resumed, memory preserved
 *
 * Requires: Docker with experimental mode, CRIU, local registry on :5000
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  docker,
  captureContainerConfig,
  createCheckpoint,
  extractCheckpointFiles,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
} from "../docker.mjs";

const REGISTRY = "localhost:5000";
const CONTAINER = "machinen-e2e-test";
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
  // Clean up images
  for (const pattern of [`${REGISTRY}/*`, `${COMMITTED}`]) {
    try { exec(`docker images --format '{{.Repository}}:{{.Tag}}' ${pattern} | xargs -r docker rmi -f`); } catch {}
  }
}

// --- main ---

async function main() {
  cleanup();

  try {
    // ── 1. Create container with known state ──────────────────────────
    console.log("1. Creating test container with state...");

    // The entrypoint: write files, then loop incrementing a counter.
    // After CRIU restore the shell process resumes mid-loop with $COUNTER
    // and $SECRET still in memory.
    const script = [
      'SECRET="machinen-e2e-42"',
      'echo "$SECRET" > /tmp/secret.txt',
      'echo "hello from machinen" > /tmp/hello.txt',
      'COUNTER=0',
      'while true; do COUNTER=$((COUNTER+1)); echo "$COUNTER:$SECRET" > /tmp/state.txt; sleep 1; done',
    ].join("; ");

    execFileSync("docker", [
      "run", "-d",
      "--name", CONTAINER,
      "--security-opt", "seccomp=unconfined",
      "--network", "host",
      "alpine", "sh", "-c", script,
    ], { stdio: "pipe" });

    // Let the counter tick a few times
    await new Promise(r => setTimeout(r, 3000));

    // Snapshot pre-checkpoint state
    const preSecret = dockerExec(CONTAINER, "cat /tmp/secret.txt");
    const preHello = dockerExec(CONTAINER, "cat /tmp/hello.txt");
    const preState = dockerExec(CONTAINER, "cat /tmp/state.txt");
    const preCounter = parseInt(preState.split(":")[0], 10);
    const prePid = dockerExec(CONTAINER, "sh -c 'echo $$'");

    console.log(`   secret=${preSecret}  hello=${preHello}  counter=${preCounter}  pid=${prePid}`);
    assert(preSecret === "machinen-e2e-42", `unexpected secret: ${preSecret}`);
    assert(preHello === "hello from machinen", `unexpected hello: ${preHello}`);
    assert(preCounter > 0, `counter should be > 0, got ${preCounter}`);

    // ── 2. Freeze (commit → clean → checkpoint → image → push) ──────
    console.log("2. Freezing...");

    // Commit filesystem
    exec(`docker commit ${CONTAINER} ${COMMITTED}`);

    const container = docker.getContainer(CONTAINER);
    const info = await container.inspect();
    const config = captureContainerConfig(info);

    // Create clean copy (no bind mounts)
    rmContainer(CLEAN);
    exec(`docker stop ${CONTAINER}`);
    exec(`docker run -d --name ${CLEAN} --security-opt seccomp=unconfined --network host ${COMMITTED}`);
    await new Promise(r => setTimeout(r, 2000));

    // Checkpoint
    const { containerId, checkpointId } = await createCheckpoint(CLEAN);
    console.log(`   checkpoint: ${checkpointId}`);

    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

    try {
      const prefix = `${REGISTRY}/machinen/${CONTAINER}`;
      const tag = `${prefix}:${checkpointId}`;
      const latestTag = `${prefix}:latest`;
      const baseTag = `${prefix}:base`;

      // Tag + push committed image as base
      exec(`docker tag ${COMMITTED} ${baseTag}`);
      pushImage(baseTag);

      // Build + push checkpoint image
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

      // ── 3. Simulate fresh pull (remove local knowledge) ────────────
      console.log("3. Cleaning local state...");
      rmContainer(CLEAN);
      rmContainer(CONTAINER);
      // Remove committed image so restore must use the registry base
      try { exec(`docker rmi ${COMMITTED}`); } catch {}

      // ── 4. Restore locally ─────────────────────────────────────────
      console.log("4. Restoring locally...");
      pullImage(latestTag);
      restoreLocally(latestTag, RESTORED);

      // Let the process tick after restore
      await new Promise(r => setTimeout(r, 3000));

      // ── 5. Verify ──────────────────────────────────────────────────
      console.log("5. Verifying...");

      // Container is running
      const status = exec(`docker inspect --format '{{.State.Status}}' ${RESTORED}`);
      assert(status === "running", `container not running (status: ${status})`);
      console.log("   [pass] container is running");

      // Files preserved
      const postSecret = dockerExec(RESTORED, "cat /tmp/secret.txt");
      assert(postSecret === "machinen-e2e-42", `secret lost: ${postSecret}`);
      console.log("   [pass] /tmp/secret.txt preserved");

      const postHello = dockerExec(RESTORED, "cat /tmp/hello.txt");
      assert(postHello === "hello from machinen", `hello lost: ${postHello}`);
      console.log("   [pass] /tmp/hello.txt preserved");

      // Process resumed — state.txt should have counter:secret format
      const postState = dockerExec(RESTORED, "cat /tmp/state.txt");
      const [counterStr, secret] = postState.split(":");
      const postCounter = parseInt(counterStr, 10);

      assert(secret === "machinen-e2e-42", `in-memory SECRET lost after restore: ${secret}`);
      console.log("   [pass] in-memory $SECRET survived restore");

      assert(postCounter > preCounter, `counter did not advance (pre=${preCounter} post=${postCounter})`);
      console.log(`   [pass] counter advanced: ${preCounter} → ${postCounter} (process memory restored)`);

      // Process is running (the sh loop)
      const ps = dockerExec(RESTORED, "ps aux");
      assert(ps.includes("sleep"), `sleep process not found in:\n${ps}`);
      console.log("   [pass] process tree restored");

      console.log("\nAll e2e checks passed.");
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
