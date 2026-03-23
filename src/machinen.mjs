#!/usr/bin/env node

import { execSync, spawnSync, spawn } from "node:child_process";
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
} from "./docker.mjs";
import { checkPrerequisites } from "./preflight.mjs";


import {
  listMachines,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
} from "./cloud.mjs";
import { getRegistry, ensureDockerLogin, remoteDockerLogin } from "./registry.mjs";
import { createPowerWatcher } from "./power.mjs";
import { sendTelegram } from "./notify.mjs";

// --- freeze ---

async function cmdFreeze(containerName) {
  await checkPrerequisites(docker);
  ensureDockerLogin();

  const { url: registry } = getRegistry();

  console.log(`Freezing ${containerName}...`);

  // Step 1: Commit the running container to capture filesystem state
  // (including bind-mounted files which won't survive checkpoint/restore)
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const commitImage = `${containerName}-committed`;
  const config = captureContainerConfig(info);

  // Extract bind-mounted files BEFORE stopping — bind mounts disappear when stopped.
  // Devcontainers use info.Mounts (not HostConfig.Binds), so check both and dedupe.
  const binds = [...new Set([
    ...(config.Binds || []).map(b => b.split(":")[1]),
    ...(info.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
  ].filter(Boolean))];
  const workspaceTmpDir = binds.length ? fs.mkdtempSync(path.join(os.tmpdir(), "machinen-ws-")) : null;
  const savedBinds = [];
  for (const containerPath of binds) {
    const tarName = `bind-${containerPath.replace(/\//g, "_")}.tar`;
    const tarPath = path.join(workspaceTmpDir, tarName);
    try {
      execSync(`docker cp ${containerName}:${containerPath} - > ${tarPath}`, {
        stdio: ["pipe", "pipe", "pipe"], shell: true,
      });
      savedBinds.push({ containerPath, tarPath });
      console.log(`Saved bind mount: ${containerPath}`);
    } catch {
      // Skip mounts that can't be copied (sockets, etc.)
    }
  }

  // Commit and stop
  console.log("Committing container filesystem...");
  execSync(`docker commit ${containerName} ${commitImage}`, { stdio: "pipe" });

  const cleanName = `${containerName}-clean`;
  try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
  execSync(`docker stop ${containerName}`, { stdio: "pipe" });

  // Run the committed image with a simple sleep — the filesystem is already
  // captured via commit, and a trivial process avoids CRIU failures from
  // complex entrypoints (e.g. docker-init.sh in devcontainers).
  execSync([
    "docker run -d",
    `--name ${cleanName}`,
    "--entrypoint sleep",
    "--security-opt seccomp=unconfined",
    "--network host",
    commitImage,
    "infinity",
  ].join(" "), { stdio: "pipe" });

  // Copy bind-mounted files into the clean container so they're in the filesystem
  for (const { containerPath, tarPath } of savedBinds) {
    const parent = path.posix.dirname(containerPath);
    execSync(`cat ${tarPath} | docker cp - ${cleanName}:${parent}`, {
      stdio: ["pipe", "pipe", "pipe"], shell: true,
    });
    console.log(`Restored bind mount into clean container: ${containerPath}`);
  }
  if (workspaceTmpDir) fs.rmSync(workspaceTmpDir, { recursive: true, force: true });

  // Re-commit the clean container so workspace files are baked into the image
  // (CRIU only captures process state, not filesystem changes to the writable layer)
  if (savedBinds.length > 0) {
    console.log("Re-committing with workspace files...");
    execSync(`docker commit ${cleanName} ${commitImage}`, { stdio: "pipe" });
  }

  // Give the process a moment to start
  await new Promise(r => setTimeout(r, 1000));

  // Step 3: Checkpoint the clean container (no OrbStack mounts)
  const { containerId, checkpointId } = await createCheckpoint(cleanName);
  console.log(`Checkpoint: ${checkpointId}`);

  console.log("Extracting checkpoint files...");
  const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

  try {
    const prefix = `${registry}/machinen/${containerName}`;
    const tag = `${prefix}:${checkpointId}`;
    const latestTag = `${prefix}:latest`;
    const baseTag = `${prefix}:base-${checkpointId}`;
    const baseLatestTag = `${prefix}:base`;

    // Push the committed image as the base — restore needs identical layers
    execSync(`docker tag ${commitImage} ${baseTag}`, { stdio: "pipe" });
    execSync(`docker tag ${commitImage} ${baseLatestTag}`, { stdio: "pipe" });
    pushImage(baseTag);
    pushImage(baseLatestTag);

    buildCheckpointImage(tarPath, commitImage, config, checkpointId, tag, [], baseLatestTag, containerId);
    execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });

    pushImage(tag);
    pushImage(latestTag);

    console.log(`Frozen: ${tag}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
    try { execSync(`docker rmi ${commitImage}`, { stdio: "pipe" }); } catch {}
  }
}

// --- restore ---

async function cmdRestore(args) {
  const containerName = args.container;
  const { url: registry } = getRegistry();
  const prefix = `${registry}/machinen/${containerName}`;
  const imageTag = `${prefix}:latest`;

  checkSyncStatus(containerName);

  if (!args.local && !args.remote) {
    console.error("Specify --local or --remote.\n  machinen restore --local\n  machinen restore --remote");
    process.exit(1);
  }

  if (args.local) {
    console.log(`Restoring ${containerName} locally from ${imageTag}...`);
    pullImage(imageTag);
    const restoredName = `${containerName}-restored`;
    restoreLocally(imageTag, restoredName);
    console.log(`\nRestored as: ${restoredName}`);
    console.log(`Shell: machinen open`);
    return;
  }

  const ip = await provisionServer({ name: containerName });
  remoteDockerLogin(ssh, ip);
  remoteRestore(ip, containerName, imageTag, registry);

  console.log(`\nServer: ${ip}`);
  console.log(`Shell: machinen open --remote`);
}

// --- up ---

function detectDevcontainerFile(cwd) {
  const candidates = [
    ".devcontainer/devcontainer.json",
    ".devcontainer.json",
  ];

  const dcDir = path.join(cwd, ".devcontainer");
  if (fs.existsSync(dcDir) && fs.statSync(dcDir).isDirectory()) {
    try {
      const entries = fs.readdirSync(dcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push(`.devcontainer/${entry.name}/devcontainer.json`);
        }
      }
    } catch {}
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function sanitizeBranch(branch) {
  return branch.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function currentContainerName() {
  const branch = currentBranch();
  return branch ? `machinen-${sanitizeBranch(branch)}` : null;
}

function detectRepoRoot(cwd) {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return cwd;
  }
}

function gitRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

// --- sync daemon helpers ---

function syncStatusPath(containerName) {
  const root = gitRoot();
  if (root) {
    const dir = path.join(root, ".machinen");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "sync-status.json");
  }
  const dir = path.join(os.homedir(), ".machinen", containerName);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "sync-status.json");
}

function writeSyncStatus(statusPath, data) {
  const tmp = statusPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, statusPath);
}

function isAuthError(err) {
  const msg = err?.message || String(err);
  return /write:packages|unauthorized|authentication required|403/i.test(msg);
}

function containerExists(name) {
  try {
    execSync(`docker inspect --format '{{.State.Status}}' ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function cmdUp(args) {
  const cwd = args.cwd || process.cwd();
  const repoRoot = detectRepoRoot(cwd);
  const file = args.file || detectDevcontainerFile(repoRoot);

  if (!file) {
    throw new Error(
      "No devcontainer.json found. Specify with --file <path>\n" +
      "  e.g., machinen up --file .devcontainer/devcontainer.json"
    );
  }

  ensureDockerLogin();
  const { url: registry } = getRegistry();
  const configPath = path.join(repoRoot, file);

  const repoName = path.basename(repoRoot);
  const branch = args._positional?.[1] || currentBranch() || "main";
  const safeBranch = sanitizeBranch(branch);
  const imagePrefix = `${registry}/machinen/${repoName}/${safeBranch}`;
  const containerName = `machinen-${safeBranch}`;

  await checkPrerequisites(docker);

  // Step 1: Start local devcontainer
  console.log(`Starting ${containerName} from ${file}...`);
  const upResult = spawnSync("npx", ["devcontainer",
    "up",
    "--workspace-folder", repoRoot,
    "--config", configPath,
    "--additional-features", '{"ghcr.io/devcontainers/features/docker-outside-of-docker:1":{}}',
    "--remove-existing-container",
  ], { stdio: "inherit" });

  if (upResult.status !== 0) {
    throw new Error("devcontainer up failed");
  }

  // Get the container ID/name that devcontainer created and rename it
  const dcContainerOriginal = execSync(
    `docker ps --filter "label=devcontainer.local_folder=${repoRoot}" --format "{{.Names}}"`,
    { stdio: "pipe", encoding: "utf-8" }
  ).trim();

  if (!dcContainerOriginal) {
    throw new Error("Could not find devcontainer. Is it running?");
  }

  // Rename to machinen-<branch>
  const dcContainer = containerName;
  if (dcContainerOriginal !== dcContainer) {
    try { execSync(`docker rm -f ${dcContainer}`, { stdio: "pipe" }); } catch {}
    execSync(`docker rename ${dcContainerOriginal} ${dcContainer}`, { stdio: "pipe" });
  }

  console.log(`Container: ${dcContainer}`);
  console.log(`Image prefix: ${imagePrefix}`);

  // Step 2: Start power watcher for sleep/wake handoff
  let remoteIp = null;

  console.log("Watching for sleep/wake events...");
  const watcher = createPowerWatcher({
    onSleep: async ({ canDelaySleep }) => {
      console.log("\nSleep detected — migrating to remote...");

      try {
        // Commit the container to capture filesystem
        const commitImage = `${dcContainer}-committed`;
        console.log("Committing container filesystem...");
        execSync(`docker commit ${dcContainer} ${commitImage}`, { stdio: "pipe" });

        // Extract bind-mounted files before stopping
        const dcInfo = await docker.getContainer(dcContainer).inspect();
        const dcBinds = [...new Set([
          ...(dcInfo.HostConfig.Binds || []).map(b => b.split(":")[1]),
          ...(dcInfo.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
        ].filter(Boolean))];
        const wsTmp = dcBinds.length ? fs.mkdtempSync(path.join(os.tmpdir(), "machinen-ws-")) : null;
        const savedWs = [];
        for (const cp of dcBinds) {
          const tp = path.join(wsTmp, `bind-${cp.replace(/\//g, "_")}.tar`);
          try {
            execSync(`docker cp ${dcContainer}:${cp} - > ${tp}`, { stdio: ["pipe", "pipe", "pipe"], shell: true });
            savedWs.push({ containerPath: cp, tarPath: tp });
          } catch {}
        }

        // Create a clean copy without bind mounts, checkpoint it
        const cleanName = `${dcContainer}-clean`;
        try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
        execSync(`docker stop ${dcContainer}`, { stdio: "pipe" });
        execSync(`docker run -d --name ${cleanName} --entrypoint sleep --security-opt seccomp=unconfined --network host ${commitImage} infinity`, { stdio: "pipe" });

        // Copy bind-mounted files into clean container + re-commit
        for (const { containerPath, tarPath: tp } of savedWs) {
          const parent = path.posix.dirname(containerPath);
          execSync(`cat ${tp} | docker cp - ${cleanName}:${parent}`, { stdio: ["pipe", "pipe", "pipe"], shell: true });
        }
        if (wsTmp) fs.rmSync(wsTmp, { recursive: true, force: true });
        if (savedWs.length > 0) {
          execSync(`docker commit ${cleanName} ${commitImage}`, { stdio: "pipe" });
        }

        await new Promise(r => setTimeout(r, 1000));

        const { containerId, checkpointId } = await createCheckpoint(cleanName);
        const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

        try {
          const tag = `${imagePrefix}:${checkpointId}`;
          const latestTag = `${imagePrefix}:latest`;
          const baseTag = `${imagePrefix}:base-${checkpointId}`;
          const baseLatestTag = `${imagePrefix}:base`;

          execSync(`docker tag ${commitImage} ${baseTag}`, { stdio: "pipe" });
          execSync(`docker tag ${commitImage} ${baseLatestTag}`, { stdio: "pipe" });
          pushImage(baseTag);
          pushImage(baseLatestTag);

          buildCheckpointImage(tarPath, commitImage, {}, checkpointId, tag, [], baseLatestTag, containerId);
          execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });
          pushImage(tag);
          pushImage(latestTag);

          // Provision server now (only when we actually need it)
          console.log("Provisioning remote server...");
          remoteIp = await provisionServer({ name: dcContainer });
          remoteDockerLogin(ssh, remoteIp);

          remoteRestore(remoteIp, dcContainer, latestTag, registry);
          await sendTelegram(`Your machine is running on Hetzner at ${remoteIp}`);
          console.log(`Remote restore complete: ${remoteIp}`);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
          try { execSync(`docker rmi ${commitImage}`, { stdio: "pipe" }); } catch {}
        }
      } catch (err) {
        console.error("Sleep migration failed:", err.message);
      }
    },

    onWake: async () => {
      console.log("\nWake detected — migrating back to local...");

      if (!remoteIp) {
        console.log("No remote container to restore from.");
        return;
      }

      try {
        const { latestTag } = remoteFreeze(remoteIp, dcContainer, registry);

        pullImage(latestTag);
        restoreLocally(latestTag, dcContainer);

        console.log("Destroying remote server...");
        destroyServer(dcContainer);
        remoteIp = null;

        console.log("Local restore complete.");
        await sendTelegram("Your machine is back on your laptop.");
      } catch (err) {
        console.error("Wake migration failed:", err.message);
      }
    },
  });

  // Step 5: SSH into the devcontainer
  console.log(`\nConnecting to devcontainer...\n`);
  const shell = spawn("npx", ["devcontainer",
    "exec",
    "--workspace-folder", repoRoot,
    "--config", configPath,
    "/bin/bash",
  ], { stdio: "inherit" });

  await new Promise((resolve) => {
    shell.on("exit", async () => {
      console.log("\nShell exited. Cleaning up...");
      watcher.stop();

      // Destroy remote server if one was provisioned during sleep
      if (remoteIp) {
        destroyServer(dcContainer);
      }
      resolve();
    });
  });
}

// --- open ---

function cmdOpen(args) {
  const containerName = args.container;

  if (!args.local && !args.remote) {
    console.error("Specify --local or --remote.\n  machinen open --local\n  machinen open --remote");
    process.exit(1);
  }

  if (args.remote) {
    const machines = listMachines();
    const machine = machines.find(m => m.name === containerName && m.ip);
    if (!machine) {
      console.error(`No remote server found for ${containerName}.`);
      process.exit(1);
    }
    console.log(`Opening shell on remote server ${machine.ip}...`);
    const shell = spawnSync(
      "ssh",
      ["-t", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR",
       `root@${machine.ip}`, `docker exec -it ${containerName} /bin/bash`],
      { stdio: "inherit" }
    );
    process.exit(shell.status || 0);
  }

  // Local: try both <name> and <name>-restored
  for (const name of [containerName, `${containerName}-restored`]) {
    try {
      const status = execSync(
        `docker inspect --format '{{.State.Status}}' ${name}`,
        { stdio: "pipe", encoding: "utf-8" }
      ).trim();
      if (status === "running") {
        console.log(`Opening shell in local container ${name}...`);
        const shell = spawnSync("docker", ["exec", "-it", name, "/bin/bash"], { stdio: "inherit" });
        process.exit(shell.status || 0);
      }
    } catch {}
  }

  console.error(`No running local container found for ${containerName}.`);
  process.exit(1);
}

// --- logs ---

function cmdLogs(args) {
  const containerName = args.container;
  if (!containerName) {
    const machines = listMachines();
    if (machines.length === 0) {
      console.log("No active machines.");
      return;
    }
    for (const m of machines) {
      console.log(`${m.name}  ${m.location}  ${m.ip || ""}  ${m.status || ""}`);
    }
    return;
  }

  // Check if there's a remote server for this container
  const machines = listMachines();
  const machine = machines.find(m => m.name === containerName && m.ip);
  if (!machine) throw new Error(`No remote server for ${containerName}.`);
  ssh(machine.ip, `docker logs -f ${containerName}`);
}

// --- destroy ---

async function cmdDestroy(args) {
  const name = args.name || args.container;

  if (args.local) {
    // Remove local containers (<name> and <name>-restored)
    let found = false;
    for (const n of [name, `${name}-restored`]) {
      try {
        execSync(`docker rm -f ${n}`, { stdio: "pipe" });
        console.log(`Removed local container ${n}.`);
        found = true;
      } catch {}
    }
    if (!found) console.log(`No local containers found for ${name}.`);
    return;
  }

  if (args.remote || !name) {
    // Destroy remote server(s)
    if (!name) {
      const machines = listMachines();
      const remotes = machines.filter(m => m.ip);
      if (remotes.length === 0) {
        console.log("No remote servers to destroy.");
        return;
      }
      for (const m of remotes) {
        destroyServer(m.name);
      }
      return;
    }
    destroyServer(name);
    return;
  }

  // No flag: destroy both local and remote
  let found = false;
  for (const n of [name, `${name}-restored`]) {
    try {
      execSync(`docker rm -f ${n}`, { stdio: "pipe" });
      console.log(`Removed local container ${n}.`);
      found = true;
    } catch {}
  }
  try {
    destroyServer(name);
    found = true;
  } catch {}
  if (!found) console.log(`Nothing found for ${name}.`);
}

// --- sync ---

async function cmdSync(args) {
  if (args.help) {
    console.log(`Usage: machinen sync [container-name] [options]

  Run a long-lived process that periodically pushes container checkpoints to
  the registry so that 'machinen restore' can always pull the latest image.

Options:
  --interval <seconds>    Sync interval in seconds (default: 300, minimum: 30)
  --once                  Run a single sync and exit (exit 0 on success, 1 on failure)

Environment:
  MACHINEN_SYNC_INTERVAL  Override the sync interval in seconds`);
    process.exit(0);
  }

  const once = !!args.once;

  // Parse and validate interval
  const DEFAULT_INTERVAL_S = 300;
  const MIN_INTERVAL_S = 30;
  const rawInterval = args.interval === undefined
    ? (process.env.MACHINEN_SYNC_INTERVAL || String(DEFAULT_INTERVAL_S))
    : String(args.interval);
  const intervalS = Number(rawInterval);
  if (!Number.isFinite(intervalS) || intervalS <= 0) {
    console.error(`[ERROR] Invalid --interval value: "${rawInterval}". Must be a positive number.`);
    process.exit(1);
  }
  if (intervalS < MIN_INTERVAL_S) {
    console.error(`[ERROR] --interval minimum is ${MIN_INTERVAL_S} seconds. Got: ${intervalS}.`);
    process.exit(1);
  }
  const intervalMs = intervalS * 1000;

  // Validate registry auth at startup
  let registry;
  try {
    const { url } = getRegistry();
    registry = url;
  } catch (err) {
    console.error(`[ERROR] Registry auth failed: ${err.message}`);
    process.exit(1);
  }

  // Resolve container name
  const containerName = args.container;
  if (!containerName) {
    console.error(`[ERROR] No container name given and none could be auto-detected (not in a git repo?). Usage: machinen sync <container>`);
    process.exit(1);
  }
  if (!containerExists(containerName)) {
    console.error(`[ERROR] Container "${containerName}" not found in Docker.`);
    process.exit(1);
  }

  const statusPath = syncStatusPath(containerName);
  const BASE_BACKOFF_MS = 60 * 1000;
  const MAX_BACKOFF_MS = 15 * 60 * 1000;

  function nextIntervalMs(consecutiveFailures) {
    if (consecutiveFailures === 0) return intervalMs;
    return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
  }

  let syncCount = 0;
  let consecutiveFailures = 0;
  let lastSync = null;
  let lastSyncSuccess = null;
  const pid = process.pid;

  function syncLog(level, msg) {
    const ts = new Date().toISOString();
    if (level === "ERROR" || level === "WARN") {
      process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
    } else {
      process.stdout.write(`[${ts}] [${level}] ${msg}\n`);
    }
  }

  function updateStatus() {
    try {
      writeSyncStatus(statusPath, {
        pid,
        container: containerName,
        registry,
        lastSync,
        lastSyncSuccess,
        syncCount,
        consecutiveFailures,
        currentIntervalMs: nextIntervalMs(consecutiveFailures),
      });
    } catch {
      // Status write failure is non-fatal
    }
  }

  async function runSync() {
    syncLog("INFO", `Syncing ${containerName}...`);
    const { containerId, checkpointId, config } = await createCheckpoint(containerName, { exit: false });
    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);
    try {
      const prefix = `${registry}/machinen/${containerName}`;
      const tag = `${prefix}:${checkpointId}`;
      const latestTag = `${prefix}:latest`;
      const baseTag = `${prefix}:base-${checkpointId}`;
      const baseLatestTag = `${prefix}:base`;

      execSync(`docker tag ${config.Image} ${baseTag}`, { stdio: "pipe" });
      execSync(`docker tag ${config.Image} ${baseLatestTag}`, { stdio: "pipe" });
      pushImage(baseTag);
      pushImage(baseLatestTag);

      buildCheckpointImage(tarPath, config.Image, config, checkpointId, tag, [], baseLatestTag, containerId);
      execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });
      pushImage(tag);
      pushImage(latestTag);

      syncLog("INFO", `Sync complete. Tag: ${checkpointId}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // --once: single sync and exit
  if (once) {
    try {
      await runSync();
      lastSync = new Date().toISOString();
      lastSyncSuccess = true;
      syncCount++;
      consecutiveFailures = 0;
      updateStatus();
      process.exit(0);
    } catch (err) {
      lastSync = new Date().toISOString();
      lastSyncSuccess = false;
      consecutiveFailures++;
      updateStatus();
      syncLog("ERROR", `Sync failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Daemon mode
  syncLog("INFO", `Starting sync daemon`);
  syncLog("INFO", `  Container: ${containerName}`);
  syncLog("INFO", `  Registry:  ${registry}`);
  syncLog("INFO", `  Interval:  ${intervalS}s`);
  syncLog("INFO", `  PID:       ${pid}`);

  let shuttingDown = false;
  let syncInProgress = false;
  let shutdownResolve;
  const shutdownPromise = new Promise(resolve => { shutdownResolve = resolve; });

  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    syncLog("INFO", `Received ${signal}. ${syncInProgress ? "Waiting for in-progress sync to finish..." : "Shutting down."}`);
    if (!syncInProgress) shutdownResolve();
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  let timer;

  async function tick() {
    if (shuttingDown) {
      shutdownResolve();
      return;
    }
    if (syncInProgress) {
      syncLog("WARN", "Previous sync still in progress, skipping.");
      scheduleNext();
      return;
    }

    syncInProgress = true;
    const syncStart = new Date().toISOString();
    try {
      await runSync();
      lastSync = syncStart;
      lastSyncSuccess = true;
      syncCount++;
      consecutiveFailures = 0;
      updateStatus();
    } catch (err) {
      lastSync = syncStart;
      lastSyncSuccess = false;
      consecutiveFailures++;
      updateStatus();

      if (isAuthError(err)) {
        syncLog("ERROR", `Sync failed (auth error): ${err.message}`);
        syncLog("WARN", "Run 'gh auth refresh -s write:packages' to fix authentication.");
      } else {
        syncLog("ERROR", `Sync failed: ${err.message}`);
      }

      if (!containerExists(containerName)) {
        syncLog("ERROR", `Container "${containerName}" no longer exists. Exiting.`);
        syncInProgress = false;
        shutdownResolve();
        return;
      }
    } finally {
      syncInProgress = false;
    }

    if (shuttingDown) {
      shutdownResolve();
    } else {
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (shuttingDown) return;
    const delay = nextIntervalMs(consecutiveFailures);
    syncLog("INFO", `Next sync in ${Math.round(delay / 1000)}s`);
    timer = setTimeout(tick, delay);
  }

  updateStatus();
  tick();

  await shutdownPromise;
  if (timer) clearTimeout(timer);
  updateStatus();
  syncLog("INFO", "Sync daemon stopped.");
  process.exit(0);
}

// --- sync status check (used by restore) ---

function checkSyncStatus(containerName) {
  let statusPath = null;
  const root = gitRoot();
  if (root) {
    const candidate = path.join(root, ".machinen", "sync-status.json");
    if (fs.existsSync(candidate)) statusPath = candidate;
  }
  if (!statusPath) {
    const candidate = path.join(os.homedir(), ".machinen", containerName, "sync-status.json");
    if (fs.existsSync(candidate)) statusPath = candidate;
  }
  if (!statusPath) return;

  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
  } catch {
    return;
  }

  if (status.lastSync) {
    const ageMs = Date.now() - new Date(status.lastSync).getTime();
    const ageMin = Math.round(ageMs / 60000);
    if (ageMs > 10 * 60 * 1000) {
      console.warn(`[WARN] Last sync was ${ageMin} minute(s) ago. Image may be stale.`);
    } else {
      console.log(`Last sync: ${status.lastSync} (${ageMin} minute(s) ago)`);
    }
  }

  if (status.pid != null) {
    let daemonRunning = false;
    try {
      process.kill(status.pid, 0);
      daemonRunning = true;
    } catch {}
    if (!daemonRunning) {
      console.log(`Sync daemon (PID ${status.pid}) is not currently running.`);
    }
  }
}

// --- arg parsing ---

function parseArgs(argv) {
  const args = { _positional: [] };
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      args._positional.push(argv[i]);
      i += 1;
    }
  }
  return args;
}

// --- main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = args._positional[0];
  const containerOrName = args._positional[1];

  args.container = containerOrName || currentContainerName();
  args.name = args.name || args.container;

  const commands = {
    up: cmdUp,
    freeze: (a) => cmdFreeze(a.container),
    restore: cmdRestore,
    open: cmdOpen,
    logs: cmdLogs,
    destroy: cmdDestroy,
    sync: cmdSync,
  };

  if (!action || !commands[action]) {
    console.log(`Usage: machinen <command> [options]

Commands:
  up [branch]           Start devcontainer for branch (default: current branch)
    --file <path>       Path to devcontainer.json (auto-detected from cwd)

  freeze [name]         Checkpoint, package as image, push to registry
  restore [name]        Restore container from checkpoint
    --local             Restore locally into <name>-restored
    --remote            Provision server and restore remotely (default)
  sync [name]           Run sync daemon: push checkpoints to registry on interval
    --interval <s>      Sync interval in seconds (default: 300, minimum: 30)
    --once              Run a single sync and exit
  open [name]           Open shell in container
    --local             Open shell in local container
    --remote            Open shell on remote server
  logs [name]           Tail remote container logs (or list machines)
  destroy [name]        Tear down container (both local and remote)
    --local             Only remove local containers
    --remote            Only destroy remote server

All commands default to the current git branch if no name is given.

Cloud provider (default: hetzner):
  hcloud CLI            Install: brew install hcloud
                        Auth: hcloud context create machinen

Environment:
  HCLOUD_TOKEN          Hetzner API token (alternative to hcloud context auth)
  MACHINEN_SYNC_INTERVAL  Sync interval in seconds (overrides --interval default)
  TELEGRAM_BOT_TOKEN    Telegram bot token (optional, for notifications)
  TELEGRAM_CHAT_ID      Telegram chat ID (optional, for notifications)

Registry: Uses ghcr.io via authenticated gh CLI (run 'gh auth login' first)`);
    process.exit(action ? 1 : 0);
  }

  if ((action === "freeze" || action === "restore") && !args.container) {
    console.error(`Container name required (not in a git repo?). Usage: machinen ${action} <container>`);
    process.exit(1);
  }

  await commands[action](args);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
