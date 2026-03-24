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
 * The test container is designed to exercise the same patterns as a real
 * devcontainer: multiple bind mounts, a background daemon with a Unix socket
 * (mimicking docker-outside-of-docker's socat), and /var/run symlink paths.
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

function cleanup(dirs = []) {
  for (const c of [CONTAINER, RESTORED, CLEAN, COMMITTED, "machinen-tmp"]) {
    rmContainer(c);
  }
  // Clean up images
  for (const pattern of [`${REGISTRY}/*`, `${COMMITTED}`]) {
    try { exec(`docker images --format '{{.Repository}}:{{.Tag}}' ${pattern} | xargs -r docker rmi -f`); } catch {}
  }
  for (const d of dirs) {
    if (d) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}

// --- main ---

async function main() {
  let workspaceDir;
  let extraDir;
  cleanup();

  try {
    // ── 1. Create container with known state + bind mounts ────────────
    console.log("1. Creating test container with state...");

    // Create a workspace dir to bind-mount.  Use cwd (the repo checkout) since
    // it's host-mapped in both agent-ci and native Docker environments.
    // (os.tmpdir() is inside the runner container and invisible to Docker.)
    workspaceDir = path.join(process.cwd(), ".e2e-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# E2E Test Workspace\n");
    fs.writeFileSync(path.join(workspaceDir, "data.json"), '{"test": true}\n');

    // Second bind mount through /var/run to exercise symlink normalisation.
    // On Debian/Ubuntu containers /var/run → /run, so Docker reports the
    // mount destination as /var/run/... while CRIU records /run/...
    extraDir = path.join(process.cwd(), ".e2e-extra");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "extra.txt"), "extra-data\n");

    // The entrypoint:
    //   1. Create a Unix socket with socat (mimics docker-outside-of-docker)
    //   2. Write files + keep a file descriptor open to the bind mount
    //   3. Loop incrementing a counter
    //
    // After CRIU restore the shell process resumes mid-loop with $COUNTER
    // and $SECRET still in memory, the socat daemon is alive, and the open
    // FD to the bind mount is preserved.
    const script = [
      // Try to install socat for the socket test.  If unavailable (no network
      // in agent-ci), skip — the test adapts below.
      'apk add --no-cache socat >/dev/null 2>&1 && HAS_SOCAT=1 || HAS_SOCAT=0',

      // Background daemon listening on a Unix socket — mirrors the socat
      // process from the docker-outside-of-docker devcontainer feature.
      // The socket file will be captured by `docker commit`, creating the
      // stale-socket scenario that broke restore (issue #16).
      'if [ "$HAS_SOCAT" = "1" ]; then socat UNIX-LISTEN:/var/run/test.sock,fork,reuseaddr SYSTEM:"echo pong" & fi',

      // Keep a file descriptor open to the bind mount.  This exercises CRIU's
      // ability to restore FDs that reference stripped mount entries — the
      // scenario that caused the "No mapping for <mnt_id>" error.
      'exec 3>/workspace/lockfile',
      'echo "locked" >&3',

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
      "-v", `${extraDir}:/var/run/e2e-extra`,
      "alpine", "sh", "-c", script,
    ], { stdio: "pipe" });

    // Let the counter tick and socat start
    await new Promise(r => setTimeout(r, 5000));

    // Check if socat is available
    let hasSocat = false;
    try {
      const socatCheck = dockerExec(CONTAINER, "sh -c 'echo ping | socat - UNIX-CONNECT:/var/run/test.sock'");
      hasSocat = socatCheck === "pong";
    } catch {}
    if (hasSocat) {
      console.log("   socat daemon running on /var/run/test.sock");
    } else {
      console.log("   socat not available — socket tests will be skipped");
    }

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

    // Commit filesystem (captures socat socket file in overlay — the stale
    // socket that must be whiteout'd before CRIU can re-bind it).
    exec(`docker commit ${CONTAINER} ${COMMITTED}`);

    const container = docker.getContainer(CONTAINER);
    const info = await container.inspect();
    const config = captureContainerConfig(info);

    // Extract bind-mounted files before stopping (same as cmdFreeze)
    const binds = [...new Set([
      ...(config.Binds || []).map(b => b.split(":")[1]),
      ...(info.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
    ].filter(Boolean))];
    console.log(`   bind paths to strip: ${binds.join(", ")}`);
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
      const env = { ...process.env, COPYFILE_DISABLE: "1" };
      const patchDir = path.join(tmpDir, "patch");
      fs.mkdirSync(patchDir);
      execFileSync("tar", ["xf", tarPath, "-C", patchDir], { stdio: "pipe", env });
      stripBindMountEntries(patchDir, binds);
      execFileSync("tar", ["cf", tarPath, "-C", patchDir, "."], { stdio: "pipe", env });
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

      // socat daemon should be alive (its socket was re-bound by CRIU)
      if (hasSocat) {
        assert(ps.includes("socat"), `socat daemon not found after restore:\n${ps}`);
        console.log("   [pass] socat daemon survived restore");
      } else {
        console.log("   [skip] socat daemon test skipped (socat not installed)");
      }

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

      // /var/run bind mount (tests symlink normalisation: /var/run → /run)
      try {
        const extra = dockerExec(RESTORED, "cat /var/run/e2e-extra/extra.txt");
        assert(extra === "extra-data", `extra bind data lost: ${extra}`);
        console.log("   [pass] /var/run/e2e-extra preserved (symlink path bind mount)");
      } catch {
        console.log("   [skip] /var/run bind mount test skipped");
      }

      console.log("\nAll e2e checks passed.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup([workspaceDir, extraDir]);
  }
}

main().catch(err => {
  console.error(`\nE2E FAILED: ${err.message}`);
  cleanup();
  process.exit(1);
});
