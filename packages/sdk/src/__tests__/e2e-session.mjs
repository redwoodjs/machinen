#!/usr/bin/env node

/**
 * E2E test: tmux sessions survive freeze/restore via patched CRIU
 *
 * Starts a devcontainer (javascript-node:1-22, remoteUser "node") and
 * verifies that tmux sessions — and their child processes — persist across
 * a CRIU checkpoint/restore cycle.
 *
 * The approach: tmux server runs as a child of PID 1.  Shells inside tmux
 * are grandchildren of PID 1.  CRIU captures the whole tree.  Patched CRIU
 * (scripts/patch-criu.py) removes the tty_verify_ctty pid_real check that
 * would otherwise reject checkpoint of containers with tmux PTY pairs.
 *
 * Requires: Docker with experimental mode, patched CRIU, local registry on :5000
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDiND, getDiNDHost } from "../dind.mjs";
import { reconnectDocker, docker,
  captureContainerConfig,
  createCheckpoint,
  extractCheckpointFiles,
  stripBindMountEntries,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
  hasTmuxSession,
  ensureTmuxSession,
} from "../docker.mjs";

const REGISTRY = "localhost:5000";
const CONTAINER = "machinen-e2e-session";
const RESTORED = `${CONTAINER}-restored`;
const CLEAN = `${CONTAINER}-clean`;
const COMMITTED = `${CONTAINER}-committed`;
const REMOTE_USER = "node";

// --- helpers ---

function exec(cmd) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf-8" }).trim();
}

function dockerExec(container, cmd) {
  return exec(`docker exec ${container} ${cmd}`);
}

function dockerExecUser(container, user, args) {
  return execFileSync("docker", ["exec", "--user", user, container, ...args], {
    stdio: "pipe", encoding: "utf-8",
  }).trim();
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

  // ── 0. Start DiND + local registry ────────────────────────────────────
  const scriptsDir = path.join(process.cwd(), "scripts");
  await ensureDiND(scriptsDir);
  const diNDHost = getDiNDHost();
  process.env.DOCKER_HOST = diNDHost;
  const { hostname: diNDIP, port: diNDPortStr } = new URL(diNDHost);
  reconnectDocker(diNDIP, parseInt(diNDPortStr, 10));

  // Reuse registry if already running (e2e-local may have started it).
  try { exec("docker inspect registry >/dev/null 2>&1"); }
  catch {
    exec("docker run -d -p 5000:5000 --name registry registry:2");
    for (let i = 0; i < 10; i++) {
      try { exec("docker exec registry wget -qO- http://localhost:5000/v2/ 2>/dev/null"); break; }
      catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
  }

  cleanup();

  try {
    // ── 1. Start devcontainer ─────────────────────────────────────────
    console.log("1. Starting devcontainer...");

    workspaceDir = path.join(process.cwd(), ".e2e-session-workspace");
    fs.mkdirSync(path.join(workspaceDir, ".devcontainer"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".devcontainer", "devcontainer.json"),
      JSON.stringify({
        image: "mcr.microsoft.com/devcontainers/javascript-node:1-22",
        remoteUser: REMOTE_USER,
        workspaceFolder: "/workspace",
        runArgs: ["--security-opt", "seccomp=unconfined", "--network", "host"],
      }, null, 2),
    );

    execFileSync("pnpm", [
      "exec", "devcontainer", "up",
      "--workspace-folder", workspaceDir,
      "--remove-existing-container",
    ], { stdio: "pipe" });

    const dcName = execSync(
      `docker ps --filter "label=devcontainer.local_folder=${workspaceDir}" --format "{{.Names}}"`,
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();
    assert(dcName, "devcontainer not found after up");
    if (dcName !== CONTAINER) {
      try { exec(`docker rm -f ${CONTAINER}`); } catch {}
      exec(`docker rename ${dcName} ${CONTAINER}`);
    }
    console.log(`   container: ${CONTAINER}`);

    // ── 2. Start tmux session ─────────────────────────────────────────
    console.log("2. Starting tmux session...");

    // ensureTmuxSession installs tmux as root then starts the session as REMOTE_USER
    // so the tmux socket is owned by that user and survives CRIU.
    ensureTmuxSession(CONTAINER, { user: REMOTE_USER });

    const hasTmux = hasTmuxSession(CONTAINER, "machinen", { user: REMOTE_USER });
    assert(hasTmux, "tmux session 'machinen' not found");
    console.log("   tmux session active");

    // ── 3. Write state inside tmux session ───────────────────────────
    console.log("3. Writing state inside tmux session...");

    // Send commands into tmux session — shell is a child of PID 1 via tmux server
    dockerExecUser(CONTAINER, REMOTE_USER, ["tmux", "send-keys", "-t", "machinen", "SECRET=tmux-survived", "Enter"]);
    await new Promise(r => setTimeout(r, 500));
    dockerExecUser(CONTAINER, REMOTE_USER, ["tmux", "send-keys", "-t", "machinen", "echo $SECRET > /tmp/tmux-proof.txt", "Enter"]);
    await new Promise(r => setTimeout(r, 500));
    dockerExecUser(CONTAINER, REMOTE_USER, ["tmux", "send-keys", "-t", "machinen", "COUNTER=0; while true; do COUNTER=$((COUNTER+1)); echo $COUNTER:$SECRET > /tmp/state.txt; sleep 1; done &", "Enter"]);
    await new Promise(r => setTimeout(r, 3000));

    // Verify state was written
    const preProof = dockerExec(CONTAINER, "cat /tmp/tmux-proof.txt");
    assert(preProof === "tmux-survived", `proof file has wrong content: ${preProof}`);
    console.log(`   proof: ${preProof}`);

    const preState = dockerExec(CONTAINER, "cat /tmp/state.txt");
    const preCounter = parseInt(preState.split(":")[0], 10);
    const preSecret = preState.split(":")[1];
    assert(preCounter > 0, `counter should be > 0, got ${preCounter}`);
    assert(preSecret === "tmux-survived", `secret mismatch: ${preSecret}`);
    console.log(`   counter=${preCounter}  secret=${preSecret}`);

    // Verify tmux server is in the process tree
    const ps = dockerExec(CONTAINER, "ps aux");
    assert(ps.includes("tmux"), "tmux not found in process tree");
    console.log("   tmux server in PID 1 tree");

    // ── 4. Freeze (commit → checkpoint → image → push) ────────────────
    console.log("4. Freezing...");

    exec(`docker commit ${CONTAINER} ${COMMITTED}`);

    const container = docker.getContainer(CONTAINER);
    const info = await container.inspect();
    const config = captureContainerConfig(info);

    const { containerId, checkpointId } = await createCheckpoint(CONTAINER, { exit: true });
    console.log(`   checkpoint: ${checkpointId}`);

    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

    // Strip bind-mount entries from the checkpoint so CRIU doesn't try to
    // restore mounts that don't exist in the restore container.
    // Devcontainers use --mount syntax so workspace may be in info.Mounts
    // but not config.Binds — collect from both to be safe.
    {
      const binds = [...new Set([
        ...(config.Binds || []).map(b => b.split(":")[1]),
        ...(info.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
      ].filter(Boolean))];
      if (binds.length > 0) {
        const env = { ...process.env, COPYFILE_DISABLE: "1" };
        const patchDir = path.join(tmpDir, "patch");
        fs.mkdirSync(patchDir);
        execFileSync("tar", ["xf", tarPath, "-C", patchDir], { stdio: "pipe", env });
        stripBindMountEntries(patchDir, binds);
        execFileSync("tar", ["cf", tarPath, "-C", patchDir, "."], { stdio: "pipe", env });
        fs.rmSync(patchDir, { recursive: true, force: true });
      }
    }

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

      // ── 5. Clean local state + restore ────────────────────────────────
      console.log("5. Cleaning local state...");
      rmContainer(CLEAN);
      rmContainer(CONTAINER);
      try { exec(`docker rmi ${COMMITTED}`); } catch {}

      console.log("6. Restoring locally...");
      pullImage(latestTag);
      restoreLocally(latestTag, RESTORED);

      // Let processes resume after restore
      await new Promise(r => setTimeout(r, 3000));

      // ── 6. Verify ────────────────────────────────────────────────────
      console.log("7. Verifying...");

      // Container is running
      const status = exec(`docker inspect --format '{{.State.Status}}' ${RESTORED}`);
      assert(status === "running", `container not running (status: ${status})`);
      console.log("   [pass] container is running");

      // Proof file survived
      const postProof = dockerExec(RESTORED, "cat /tmp/tmux-proof.txt");
      assert(postProof === "tmux-survived", `proof file lost: ${postProof}`);
      console.log("   [pass] /tmp/tmux-proof.txt preserved");

      // Counter still ticking with in-memory secret
      const postState1 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const [counterStr1, secret1] = postState1.split(":");
      const postCounter1 = parseInt(counterStr1, 10);

      assert(secret1 === "tmux-survived", `in-memory SECRET lost: ${secret1}`);
      console.log("   [pass] in-memory SECRET preserved across checkpoint/restore");

      assert(postCounter1 >= preCounter, `counter regressed (pre=${preCounter} post=${postCounter1})`);
      console.log(`   [pass] counter preserved: ${postCounter1} (was ${preCounter})`);

      // Counter is still incrementing (process is alive)
      await new Promise(r => setTimeout(r, 2000));
      const postState2 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const postCounter2 = parseInt(postState2.split(":")[0], 10);

      assert(postCounter2 > postCounter1, `counter not incrementing (${postCounter1} → ${postCounter2})`);
      console.log(`   [pass] counter still incrementing: ${postCounter1} → ${postCounter2}`);

      // tmux session survived restore
      const postHasTmux = hasTmuxSession(RESTORED, "machinen", { user: REMOTE_USER });
      assert(postHasTmux, "tmux session not found after restore");
      console.log("   [pass] tmux session survived restore");

      // Can send new commands into the restored tmux session
      dockerExecUser(RESTORED, REMOTE_USER, ["tmux", "send-keys", "-t", "machinen", "echo post-restore > /tmp/post.txt", "Enter"]);
      await new Promise(r => setTimeout(r, 1000));
      const postCmd = dockerExec(RESTORED, "cat /tmp/post.txt");
      assert(postCmd === "post-restore", `post-restore command failed: ${postCmd}`);
      console.log("   [pass] new commands work in restored tmux session");

      // Process tree shows tmux
      const postPs = dockerExec(RESTORED, "ps aux");
      assert(postPs.includes("tmux"), "tmux not in process tree after restore");
      console.log("   [pass] tmux in process tree after restore");

      console.log("\nAll session e2e checks passed.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup([workspaceDir]);
  }
}

main().catch(err => {
  console.error(`\nE2E FAILED: ${err.message}`);
  cleanup();
  process.exit(1);
});
