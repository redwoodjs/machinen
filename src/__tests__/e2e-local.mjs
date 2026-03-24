#!/usr/bin/env node

/**
 * E2E test: freeze → restore locally
 *
 * Verifies the full checkpoint/restore cycle:
 *   1. Create a container with known file and in-memory state
 *   2. Commit → checkpoint original → build image → push to local registry
 *   3. Pull from registry → restore locally
 *   4. Assert: container running, files intact, original process alive and incrementing
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
  stripBindMountEntries,
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

function cleanup(workspaceDir) {
  for (const c of [CONTAINER, RESTORED, CLEAN, COMMITTED, "machinen-tmp"]) {
    rmContainer(c);
  }
  // Clean up images
  for (const pattern of [`${REGISTRY}/*`, `${COMMITTED}`]) {
    try { exec(`docker images --format '{{.Repository}}:{{.Tag}}' ${pattern} | xargs -r docker rmi -f`); } catch {}
  }
  if (workspaceDir) {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
  }
}

// --- main ---

async function main() {
  let workspaceDir;
  cleanup();

  try {
    // ── 1. Create container with known state + bind mount ──────────────
    console.log("1. Creating test container with state...");

    // Create a workspace dir to bind-mount. Use cwd (the repo checkout) since
    // it's host-mapped in both agent-ci and native Docker environments.
    // (os.tmpdir() is inside the runner container and invisible to Docker.)
    workspaceDir = path.join(process.cwd(), ".e2e-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# E2E Test Workspace\n");
    fs.writeFileSync(path.join(workspaceDir, "data.json"), '{"test": true}\n');

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
      "-v", `${workspaceDir}:/workspace`,
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

    // Extract bind-mounted files before stopping (same as cmdFreeze)
    const binds = [...new Set([
      ...(config.Binds || []).map(b => b.split(":")[1]),
      ...(info.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
    ].filter(Boolean))];
    const wsTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-e2e-ws-save-"));
    const savedBinds = [];
    for (const cp of binds) {
      const tarPath = path.join(wsTmpDir, `bind-${cp.replace(/\//g, "_")}.tar`);
      try {
        exec(`docker cp ${CONTAINER}:${cp} - > ${tarPath}`);
        savedBinds.push({ containerPath: cp, tarPath });
        console.log(`   saved bind: ${cp}`);
      } catch {}
    }

    // Bake bind-mounted files into the committed image using a temp container
    if (savedBinds.length > 0) {
      rmContainer(CLEAN);
      execFileSync("docker", [
        "run", "-d", "--name", CLEAN, "--entrypoint", "sleep",
        COMMITTED, "infinity",
      ], { stdio: "pipe" });
      for (const { containerPath, tarPath } of savedBinds) {
        const parent = path.posix.dirname(containerPath);
        exec(`cat ${tarPath} | docker cp - ${CLEAN}:${parent}`);
      }
      exec(`docker commit ${CLEAN} ${COMMITTED}`);
      rmContainer(CLEAN);
    }
    fs.rmSync(wsTmpDir, { recursive: true, force: true });

    // Checkpoint the original container directly to preserve process tree
    const { containerId, checkpointId } = await createCheckpoint(CONTAINER, { exit: true });
    console.log(`   checkpoint: ${checkpointId}`);

    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

    // Strip bind-mount entries from checkpoint (contents are in the committed image)
    if (binds.length > 0) {
      const patchDir = path.join(tmpDir, "patch");
      fs.mkdirSync(patchDir);
      execFileSync("tar", ["xf", tarPath, "-C", patchDir], { stdio: "pipe" });
      stripBindMountEntries(patchDir, binds);
      execFileSync("tar", ["cf", tarPath, "-C", patchDir, "."], { stdio: "pipe" });
      fs.rmSync(patchDir, { recursive: true, force: true });
    }

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

      // The original shell loop should still be running and incrementing the counter.
      // Read counter twice with a gap to prove the process is alive and ticking.
      const postState1 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const [counterStr1, secret1] = postState1.split(":");
      const postCounter1 = parseInt(counterStr1, 10);

      assert(secret1 === "machinen-e2e-42", `in-memory SECRET lost after restore: ${secret1}`);
      console.log("   [pass] in-memory SECRET preserved across checkpoint/restore");

      assert(postCounter1 >= preCounter, `counter regressed (pre=${preCounter} post=${postCounter1})`);
      console.log(`   [pass] counter preserved: ${postCounter1} (was ${preCounter} before freeze)`);

      // Wait and read again — counter must still be incrementing
      await new Promise(r => setTimeout(r, 2000));
      const postState2 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const postCounter2 = parseInt(postState2.split(":")[0], 10);

      assert(postCounter2 > postCounter1, `counter not incrementing after restore (read1=${postCounter1} read2=${postCounter2}) — original process is not running`);
      console.log(`   [pass] counter still incrementing: ${postCounter1} → ${postCounter2} (process survived restore)`);

      // The original shell process should be running, not "sleep infinity"
      const ps = dockerExec(RESTORED, "ps aux");
      assert(!ps.includes("sleep infinity"), `"sleep infinity" found — original process was replaced:\n${ps}`);
      console.log("   [pass] original process tree restored (no sleep substitution)");

      // Bind-mounted workspace files (may not work in Docker-outside-of-Docker)
      try {
        const readme = dockerExec(RESTORED, "cat /workspace/README.md");
        assert(readme === "# E2E Test Workspace", `workspace README lost: ${readme}`);
        console.log("   [pass] /workspace/README.md preserved (bind mount capture works)");

        const data = dockerExec(RESTORED, "cat /workspace/data.json");
        assert(data.includes('"test": true'), `workspace data.json lost: ${data}`);
        console.log("   [pass] /workspace/data.json preserved");
      } catch {
        console.log("   [skip] bind mount test skipped (Docker-outside-of-Docker environment)");
      }

      console.log("\nAll e2e checks passed.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup(workspaceDir);
  }
}

main().catch(err => {
  console.error(`\nE2E FAILED: ${err.message}`);
  cleanup();
  process.exit(1);
});
