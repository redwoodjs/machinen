#!/usr/bin/env node

import { execSync, execFileSync, spawnSync, spawn } from "node:child_process";
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


// --- freezeAndPush (shared pipeline) ---

async function freezeAndPush(containerName, registry, { keepAlive = false } = {}) {
  const suffix = keepAlive ? "-snapshot" : "";
  const commitImage = `${containerName}${suffix}-committed`;
  const cleanName = `${containerName}${suffix}-clean`;

  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const config = captureContainerConfig(info);

  // Extract bind-mounted files — bind mounts disappear when stopped.
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
    } catch {
      // Skip mounts that can't be copied (sockets, etc.)
    }
  }

  execSync(`docker commit ${containerName} ${commitImage}`, { stdio: "pipe" });

  try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
  if (!keepAlive) {
    execSync(`docker stop ${containerName}`, { stdio: "pipe" });
  }

  execSync([
    "docker run -d",
    `--name ${cleanName}`,
    "--entrypoint sleep",
    "--security-opt seccomp=unconfined",
    "--network host",
    commitImage,
    "infinity",
  ].join(" "), { stdio: "pipe" });

  for (const { containerPath, tarPath } of savedBinds) {
    const parent = path.posix.dirname(containerPath);
    execSync(`cat ${tarPath} | docker cp - ${cleanName}:${parent}`, {
      stdio: ["pipe", "pipe", "pipe"], shell: true,
    });
  }
  if (workspaceTmpDir) fs.rmSync(workspaceTmpDir, { recursive: true, force: true });

  if (savedBinds.length > 0) {
    execSync(`docker commit ${cleanName} ${commitImage}`, { stdio: "pipe" });
  }

  await new Promise(r => setTimeout(r, 1000));

  const { containerId, checkpointId } = await createCheckpoint(cleanName);
  const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

  try {
    const prefix = `${registry}/machinen/${containerName}`;
    const tag = `${prefix}:${checkpointId}`;
    const latestTag = `${prefix}:latest`;
    const baseTag = `${prefix}:base-${checkpointId}`;
    const baseLatestTag = `${prefix}:base`;

    execSync(`docker tag ${commitImage} ${baseTag}`, { stdio: "pipe" });
    execSync(`docker tag ${commitImage} ${baseLatestTag}`, { stdio: "pipe" });
    pushImage(baseTag);
    pushImage(baseLatestTag);

    buildCheckpointImage(tarPath, commitImage, config, checkpointId, tag, [], baseLatestTag, containerId);
    execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });
    pushImage(tag);
    pushImage(latestTag);

    return { checkpointId, latestTag };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
    try { execSync(`docker rmi ${commitImage}`, { stdio: "pipe" }); } catch {}
  }
}

// --- freeze ---

async function cmdFreeze(args) {
  const containerName = args.container || currentContainerName();
  const keepAlive = !!args["keep-alive"];

  await checkPrerequisites(docker);
  ensureDockerLogin();
  const { url: registry } = getRegistry();

  console.log(`Freezing ${containerName}${keepAlive ? " (keep-alive)" : ""}...`);
  const { latestTag } = await freezeAndPush(containerName, registry, { keepAlive });
  console.log(`Frozen: ${latestTag}`);
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
  return /write:packages|unauthorized|authentication required|no basic auth credentials|requested access to the resource is denied|denied:|access denied|401\b|403\b/i.test(msg);
}

function containerExists(name) {
  try {
    execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", name], { stdio: "pipe" });
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

  const configPath = path.join(repoRoot, file);

  const branch = args._positional?.[1] || currentBranch() || "main";
  const safeBranch = sanitizeBranch(branch);
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

  // Open shell into the devcontainer
  console.log(`\nConnecting to devcontainer...\n`);
  const shell = spawn("npx", ["devcontainer",
    "exec",
    "--workspace-folder", repoRoot,
    "--config", configPath,
    "/bin/bash",
  ], { stdio: "inherit" });

  await new Promise((resolve) => {
    shell.on("exit", () => {
      console.log("\nShell exited.");
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

// --- watch ---

function discoverContainers() {
  try {
    const output = execSync(
      'docker ps --filter "name=machinen-" --format "{{.Names}}"',
      { stdio: "pipe", encoding: "utf-8" }
    ).trim();
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function cmdWatch(args) {
  if (args.help) {
    console.log(`Usage: machinen watch [options]

  Daemon that auto-discovers all running machinen containers, periodically
  snapshots them to the registry, and migrates them to/from cloud on
  lid close/open (sleep/wake).

Options:
  --interval <seconds>    Sync interval in seconds (default: 300, minimum: 30)

Manual trigger (for testing):
  kill -USR1 <pid>        Simulate sleep (freeze + migrate to cloud)
  kill -USR2 <pid>        Simulate wake (pull from cloud + restore locally)

Environment:
  MACHINEN_SYNC_INTERVAL  Override the sync interval in seconds`);
    process.exit(0);
  }

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
  ensureDockerLogin();
  let registry;
  try {
    const { url } = getRegistry();
    registry = url;
  } catch (err) {
    console.error(`[ERROR] Registry auth failed: ${err.message}`);
    process.exit(1);
  }

  await checkPrerequisites(docker);

  const BASE_BACKOFF_MS = 60 * 1000;
  const MAX_BACKOFF_MS = 15 * 60 * 1000;
  const pid = process.pid;

  let syncCount = 0;
  let consecutiveFailures = 0;
  let lastSync = null;
  let lastSyncSuccess = null;

  function nextIntervalMs(failures) {
    if (failures === 0) return intervalMs;
    return Math.min(BASE_BACKOFF_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS);
  }

  function watchLog(level, msg) {
    const ts = new Date().toISOString();
    if (level === "ERROR" || level === "WARN") {
      process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
    } else {
      process.stdout.write(`[${ts}] [${level}] ${msg}\n`);
    }
  }

  function updateStatus(containers) {
    for (const name of containers) {
      try {
        const statusPath = syncStatusPath(name);
        writeSyncStatus(statusPath, {
          pid,
          container: name,
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
  }

  // --- Periodic sync ---

  watchLog("INFO", "Starting watch daemon");
  watchLog("INFO", `  Registry:  ${registry}`);
  watchLog("INFO", `  Interval:  ${intervalS}s`);
  watchLog("INFO", `  PID:       ${pid}`);

  let shuttingDown = false;
  let syncInProgress = false;
  let shutdownResolve;
  const shutdownPromise = new Promise(resolve => { shutdownResolve = resolve; });

  function handleShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    watchLog("INFO", `Received ${signal}. ${syncInProgress ? "Waiting for in-progress sync to finish..." : "Shutting down."}`);
    watcher.stop();
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
      watchLog("WARN", "Previous sync still in progress, skipping.");
      scheduleNext();
      return;
    }

    const containers = discoverContainers();
    if (containers.length === 0) {
      watchLog("INFO", "No machinen containers running. Waiting...");
      scheduleNext();
      return;
    }

    syncInProgress = true;
    const syncStart = new Date().toISOString();
    try {
      for (const name of containers) {
        if (shuttingDown) break;
        watchLog("INFO", `Syncing ${name}...`);
        await freezeAndPush(name, registry, { keepAlive: true });
        watchLog("INFO", `Synced ${name}.`);
      }
      lastSync = syncStart;
      lastSyncSuccess = true;
      syncCount++;
      consecutiveFailures = 0;
      updateStatus(containers);
    } catch (err) {
      lastSync = syncStart;
      lastSyncSuccess = false;
      consecutiveFailures++;
      updateStatus(containers);

      if (isAuthError(err)) {
        watchLog("ERROR", `Sync failed (auth error): ${err.message}`);
        watchLog("WARN", "Run 'gh auth refresh -s write:packages' to fix authentication.");
      } else {
        watchLog("ERROR", `Sync failed: ${err.message}`);
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
    watchLog("INFO", `Next sync in ${Math.round(delay / 1000)}s`);
    timer = setTimeout(tick, delay);
  }

  // --- Sleep/wake migration ---

  const remoteIps = new Map(); // containerName → ip

  async function handleSleep() {
    watchLog("INFO", "Sleep detected — migrating to remote...");

    const containers = discoverContainers();
    if (containers.length === 0) {
      watchLog("INFO", "No containers to migrate.");
      return;
    }

    for (const name of containers) {
      try {
        watchLog("INFO", `Freezing ${name}...`);
        const { latestTag } = await freezeAndPush(name, registry, { keepAlive: false });

        watchLog("INFO", `Provisioning remote server for ${name}...`);
        const ip = await provisionServer({ name });
        remoteDockerLogin(ssh, ip);
        remoteRestore(ip, name, latestTag, registry);
        remoteIps.set(name, ip);

        watchLog("INFO", `${name} running on remote at ${ip}`);
      } catch (err) {
        watchLog("ERROR", `Sleep migration failed for ${name}: ${err.message}`);
      }
    }

    if (remoteIps.size > 0) {
      watchLog("INFO", `${remoteIps.size} container(s) migrated to cloud.`);
    }
  }

  async function handleWake() {
    watchLog("INFO", "Wake detected — migrating back to local...");

    if (remoteIps.size === 0) {
      watchLog("INFO", "No remote containers to restore.");
      return;
    }

    for (const [name, ip] of remoteIps) {
      try {
        const { latestTag } = remoteFreeze(ip, name, registry);
        pullImage(latestTag);
        restoreLocally(latestTag, name);

        watchLog("INFO", `Destroying remote server for ${name}...`);
        destroyServer(name);
        remoteIps.delete(name);

        watchLog("INFO", `${name} restored locally.`);
      } catch (err) {
        watchLog("ERROR", `Wake migration failed for ${name}: ${err.message}`);
      }
    }

    if (remoteIps.size === 0) {
      watchLog("INFO", "All containers back on your laptop.");
    } else {
      watchLog("WARN", `${remoteIps.size} container(s) still on remote. Run 'machinen destroy --remote' to clean up.`);
    }
  }

  const watcher = createPowerWatcher({
    onSleep: async ({ canDelaySleep }) => handleSleep(),
    onWake: async () => handleWake(),
  });

  // Manual trigger: SIGUSR1 = simulate sleep, SIGUSR2 = simulate wake
  process.on("SIGUSR1", () => {
    watchLog("INFO", "SIGUSR1 received — simulating sleep...");
    handleSleep().catch(err => watchLog("ERROR", `Simulated sleep failed: ${err.message}`));
  });
  process.on("SIGUSR2", () => {
    watchLog("INFO", "SIGUSR2 received — simulating wake...");
    handleWake().catch(err => watchLog("ERROR", `Simulated wake failed: ${err.message}`));
  });

  // Start the sync loop
  tick();

  await shutdownPromise;
  if (timer) clearTimeout(timer);
  watchLog("INFO", "Watch daemon stopped.");
  if (remoteIps.size > 0) {
    watchLog("WARN", `${remoteIps.size} remote server(s) still running. Run 'machinen destroy --remote' to clean up.`);
  }
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
    freeze: cmdFreeze,
    restore: cmdRestore,
    watch: cmdWatch,
    open: cmdOpen,
    logs: cmdLogs,
    destroy: cmdDestroy,
  };

  if (!action || !commands[action]) {
    console.log(`Usage: machinen <command> [options]

Commands:
  up [branch]           Start devcontainer for branch (default: current branch)
    --file <path>       Path to devcontainer.json (auto-detected from cwd)

  freeze [name]         Checkpoint, push to registry, stop container
    --keep-alive        Don't stop the container (live snapshot)
  restore [name]        Restore container from checkpoint
    --local             Restore locally into <name>-restored
    --remote            Provision server and restore remotely (default)
  watch                 Daemon: sync all containers + migrate on sleep/wake
    --interval <s>      Sync interval in seconds (default: 300, minimum: 30)
                        Manual: kill -USR1 <pid> (sleep) / kill -USR2 <pid> (wake)
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
