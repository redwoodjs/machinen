#!/usr/bin/env node

import { execSync, execFileSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docker,
  dockerExec,
  reconnectDocker,
  shellQuote,
  captureContainerConfig,
  createCheckpoint,
  extractCheckpointFiles,
  stripBindMountEntries,
  prepareCheckpoint,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
  ensureTmuxSession,
  hasTmuxSession,
  tmuxAttachArgs,
  resolveContainerUser,
} from "./docker.mjs";
import { checkPrerequisites } from "./preflight.mjs";
import { ensureDiND, getDiNDHost } from "./dind.mjs";


import {
  listMachines,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
  sshScript,
  SSH_OPTS,
} from "./cloud.mjs";
import { getRegistry, ensureDockerLogin, remoteDockerLogin } from "./registry.mjs";
import { createPowerWatcher } from "./power.mjs";

// --- freeze ---

async function cmdFreeze(containerName, opts = {}) {
  await checkPrerequisites(docker, { clean: opts.clean });
  ensureDockerLogin();

  const { url: registry } = getRegistry();

  console.log(`Freezing ${containerName}...`);

  const { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath } =
    await prepareCheckpoint(containerName, { stop: true });

  try {
    const prefix = `${registry}/machinen/${containerName}`;
    const tag = `${prefix}:${checkpointId}`;
    const latestTag = `${prefix}:latest`;
    const baseTag = `${prefix}:base-${checkpointId}`;
    const baseLatestTag = `${prefix}:base`;

    // Push the committed image as the base — restore needs identical layers
    dockerExec(["tag", commitImage, baseTag]);
    dockerExec(["tag", commitImage, baseLatestTag]);
    pushImage(baseTag);
    pushImage(baseLatestTag);

    buildCheckpointImage(tarPath, commitImage, config, checkpointId, tag, [], baseLatestTag, containerId);
    dockerExec(["tag", tag, latestTag]);

    pushImage(tag);
    pushImage(latestTag);

    console.log(`Frozen: ${tag}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try { dockerExec(["rm", "-f", cleanName]); } catch {}
    try { dockerExec(["rmi", commitImage]); } catch {}
  }
}

// --- restore ---

function imageNotFoundError(containerName, args) {
  if (!args.containerExplicit) {
    const branch = currentBranch();
    return [
      `Container name was auto-detected from git branch "${branch}".`,
      `No frozen image found for "${containerName}" in the registry.`,
      `To restore a specific container, pass its name explicitly:`,
      `  machinen restore --local machinen-main`,
    ].join('\n');
  }
  return [
    `No frozen image found for "${containerName}" in the registry.`,
    `Check that this container has been frozen and pushed.`,
  ].join('\n');
}

async function cmdRestore(args) {
  const containerName = args.container;

  const { url: registry, isLocal } = getRegistry();
  const prefix = `${registry}/machinen/${containerName}`;
  const imageTag = `${prefix}:latest`;

  // For local registries, check the image exists before the slow CRIU
  // preflight — no DiND needed, just an HTTP call to the registry.
  if (isLocal && args.local) {
    ensureDockerLogin(); // starts the registry container if not already running
    const slashIdx = imageTag.indexOf('/');
    const host = imageTag.slice(0, slashIdx);
    const rest = imageTag.slice(slashIdx + 1);
    const colonIdx = rest.lastIndexOf(':');
    const repo = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
    const tag = colonIdx >= 0 ? rest.slice(colonIdx + 1) : 'latest';
    // host.docker.internal only resolves inside containers; on the Mac host
    // the registry is reachable via localhost on the same port.
    const localPort = host.includes(':') ? host.split(':')[1] : '80';
    try {
      const res = await fetch(`http://localhost:${localPort}/v2/${repo}/manifests/${tag}`, { method: 'HEAD' });
      if (res.status === 404) {
        console.error(imageNotFoundError(containerName, args));
        process.exit(1);
      }
    } catch {
      // Registry unreachable — let checkPrerequisites and the pull surface the error.
    }
  }

  await checkPrerequisites(docker, { clean: !!args.clean });

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
  remoteDockerLogin(sshScript, ip);
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
    // symbolic-ref --short fails outside a git repo and in detached HEAD,
    // unlike rev-parse --abbrev-ref which can return a SHA or "HEAD".
    return execSync("git symbolic-ref --short HEAD", { stdio: "pipe", encoding: "utf-8" }).trim();
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

function gitRoot(cwd) {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe", encoding: "utf-8" }).trim();
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
  const repoRoot = gitRoot(cwd) || cwd;

  ensureDockerLogin();
  const { url: registry } = getRegistry();

  const branch = args._positional?.[1] || currentBranch() || "main";
  const safeBranch = sanitizeBranch(branch);
  const repoName = path.basename(repoRoot);
  const imagePrefix = `${registry}/machinen/${repoName}/${safeBranch}`;

  // Container name: --name flag, or derived from branch
  const containerName = args.name
    ? (args.name.startsWith("machinen-") ? args.name : `machinen-${args.name}`)
    : `machinen-${safeBranch}`;

  await checkPrerequisites(docker, { clean: !!args.clean });

  if (args.image) {
    // --- Image mode: docker run directly ---
    console.log(`Starting ${containerName} from image ${args.image}...`);

    // Remove existing container with the same name
    try { dockerExec(["rm", "-f", containerName]); } catch {}

    const runArgs = [
      "run", "-d",
      "--name", containerName,
      "--security-opt", "seccomp=unconfined",
      "--network", "host",
    ];

    // Default command: install tmux, start a session (child of PID 1), then
    // exec sleep infinity.  Shells inside tmux are in PID 1's tree and survive
    // CRIU freeze/restore (requires patched CRIU — see scripts/patch-criu.py).
    // Custom --cmd skips tmux setup.
    const cmd = args.cmd
      ? args.cmd.split(" ")
      : ["sh", "-c", "command -v tmux >/dev/null || (apk add -q tmux 2>/dev/null || apt-get -qq install -y tmux 2>/dev/null); tmux new-session -d -s machinen 2>/dev/null || true; exec sleep infinity"];
    runArgs.push(args.image, ...cmd);

    dockerExec(runArgs, { stdio: "inherit" });
    console.log(`Container: ${containerName}`);
  } else {
    // --- Devcontainer mode (existing behavior) ---
    const file = args.file || detectDevcontainerFile(repoRoot);

    if (!file) {
      throw new Error(
        "No devcontainer.json found. Specify with --file <path> or use --image <image>\n" +
        "  e.g., machinen up --file .devcontainer/devcontainer.json\n" +
        "  e.g., machinen up --image ubuntu:latest"
      );
    }

    const configPath = path.join(repoRoot, file);

    // Merge required CRIU flags into the devcontainer config without
    // overwriting the user's existing runArgs.  CRIU restore inside DiND
    // requires: (a) seccomp=unconfined so CRIU can restore process state
    // without a seccomp filter blocking restore syscalls, and (b) --network
    // host so there is no bridge network namespace for CRIU to recreate.
    const REQUIRED_RUN_ARGS = ["--security-opt", "seccomp=unconfined", "--network", "host"];
    let effectiveConfigPath = configPath;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const existing = raw.runArgs || [];
      const missing = REQUIRED_RUN_ARGS.filter(a => !existing.includes(a));
      if (missing.length > 0) {
        const merged = { ...raw, runArgs: [...existing, ...missing] };
        const tmpConfig = path.join(os.tmpdir(), `machinen-devcontainer-${Date.now()}.json`);
        fs.writeFileSync(tmpConfig, JSON.stringify(merged, null, 2));
        effectiveConfigPath = tmpConfig;
      }
    } catch {
      // If we can't read/parse the config, proceed with the original path
    }

    console.log(`Starting ${containerName} from ${file}...`);
    const upResult = spawnSync("npx", ["devcontainer",
      "up",
      "--workspace-folder", repoRoot,
      "--config", effectiveConfigPath,
      "--additional-features", '{"ghcr.io/devcontainers/features/docker-outside-of-docker:1":{}}',
      "--remove-existing-container",
    ], { stdio: "inherit" });

    if (effectiveConfigPath !== configPath) {
      try { fs.unlinkSync(effectiveConfigPath); } catch {}
    }

    if (upResult.status !== 0) {
      throw new Error("devcontainer up failed");
    }

    // Get the container ID/name that devcontainer created and rename it
    const dcContainerOriginal = dockerExec([
      "ps", "--filter", `label=devcontainer.local_folder=${repoRoot}`, "--format", "{{.Names}}",
    ]).trim();

    if (!dcContainerOriginal) {
      throw new Error("Could not find devcontainer. Is it running?");
    }

    if (dcContainerOriginal !== containerName) {
      try { dockerExec(["rm", "-f", containerName]); } catch {}
      dockerExec(["rename", dcContainerOriginal, containerName]);
    }

    // Start a tmux session inside the devcontainer so interactive shells
    // survive CRIU freeze/restore (tmux server is a child of PID 1).
    try {
      ensureTmuxSession(containerName, { user: resolveContainerUser(containerName) });
    } catch (err) {
      console.warn(`Warning: could not start tmux session: ${err.message}`);
    }
  }

  console.log(`Image prefix: ${imagePrefix}`);

  // In detach mode, just print the container name and exit
  if (args.detach) {
    console.log(`Container ${containerName} is running (detached).`);
    return;
  }

  // Start power watcher for sleep/wake handoff
  let remoteIp = null;

  console.log("Watching for sleep/wake events...");
  const watcher = createPowerWatcher({
    onSleep: async ({ canDelaySleep }) => {
      console.log("\nSleep detected — migrating to remote...");

      try {
        const { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath } =
          await prepareCheckpoint(containerName, { stop: true });

        try {
          const tag = `${imagePrefix}:${checkpointId}`;
          const latestTag = `${imagePrefix}:latest`;
          const baseTag = `${imagePrefix}:base-${checkpointId}`;
          const baseLatestTag = `${imagePrefix}:base`;

          dockerExec(["tag", commitImage, baseTag]);
          dockerExec(["tag", commitImage, baseLatestTag]);
          pushImage(baseTag);
          pushImage(baseLatestTag);

          buildCheckpointImage(tarPath, commitImage, config, checkpointId, tag, [], baseLatestTag, containerId);
          dockerExec(["tag", tag, latestTag]);
          pushImage(tag);
          pushImage(latestTag);

          console.log("Provisioning remote server...");
          remoteIp = await provisionServer({ name: containerName });
          remoteDockerLogin(sshScript, remoteIp);

          remoteRestore(remoteIp, containerName, latestTag, registry);
          console.log(`Remote restore complete: ${remoteIp}`);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          try { dockerExec(["rm", "-f", cleanName]); } catch {}
          try { dockerExec(["rmi", commitImage]); } catch {}
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
        const { latestTag } = remoteFreeze(remoteIp, containerName, registry);

        pullImage(latestTag);
        restoreLocally(latestTag, containerName);

        console.log("Destroying remote server...");
        destroyServer(containerName);
        remoteIp = null;

        console.log("Local restore complete.");
      } catch (err) {
        console.error("Wake migration failed:", err.message);
      }
    },
  });

  // Open interactive shell — prefer tmux session (survives freeze/restore),
  // fall back to bash if tmux isn't running yet.
  const containerUser = resolveContainerUser(containerName);
  const shellArgs = hasTmuxSession(containerName, undefined, { user: containerUser })
    ? tmuxAttachArgs(containerName, { user: containerUser })
    : ["exec", "-it", ...(containerUser ? ["--user", containerUser] : []), containerName, "/bin/bash"];

  {
    console.log(`\nConnecting to container...\n`);
    const shell = spawn("docker", shellArgs, { stdio: "inherit" });

    await new Promise((resolve) => {
      shell.on("exit", async () => {
        console.log("\nShell exited. Cleaning up...");
        watcher.stop();
        if (remoteIp) destroyServer(containerName);
        resolve();
      });
    });
  }
}

// --- open ---

async function cmdOpen(args) {
  const containerName = args.container;

  if (!args.local && !args.remote) {
    console.error("Specify --local or --remote.\n  machinen open --local\n  machinen open --remote");
    process.exit(1);
  }

  if (args.local) {
    // Containers live in the inner dind daemon — connect to it without running
    // the full CRIU preflight test.
    await ensureDiND();
    const diNDHost = getDiNDHost();
    process.env.DOCKER_HOST = diNDHost;
    const { hostname, port } = new URL(diNDHost);
    reconnectDocker(hostname, parseInt(port, 10));
  }

  if (args.remote) {
    const machines = listMachines();
    const machine = machines.find(m => m.name === containerName && m.ip);
    if (!machine) {
      console.error(`No remote server found for ${containerName}.`);
      process.exit(1);
    }
    console.log(`Opening shell on remote server ${machine.ip}...`);
    // Prefer tmux session; fall back to bash if tmux isn't running
    const remoteCmd = `docker exec -it ${containerName} sh -c 'tmux has-session -t machinen 2>/dev/null && exec tmux attach-session -t machinen || exec /bin/bash'`;
    const shell = spawnSync(
      "ssh",
      ["-t", ...SSH_OPTS, `root@${machine.ip}`, remoteCmd],
      { stdio: "inherit" }
    );
    process.exit(shell.status || 0);
  }

  // Local: try both <name> and <name>-restored
  for (const name of [containerName, `${containerName}-restored`]) {
    try {
      const status = dockerExec(["inspect", "--format", "{{.State.Status}}", name]).trim();
      if (status === "running") {
        const user = resolveContainerUser(name);
        const execArgs = hasTmuxSession(name, undefined, { user: user || undefined })
          ? tmuxAttachArgs(name, { user: user || undefined })
          : (() => { const a = ["exec", "-it"]; if (user) a.push("--user", user); a.push(name, "/bin/bash"); return a; })();
        console.log(`Opening shell in local container ${name}...`);
        const shell = spawnSync("docker", execArgs, { stdio: "inherit" });
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
        dockerExec(["rm", "-f", n]);
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
      dockerExec(["rm", "-f", n]);
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
    console.log(`Usage: machinen watch [container-name] [options]

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

  // Resolve container name first (before any auth)
  const containerName = args.container || currentContainerName();
  if (!containerName) {
    console.error(`[ERROR] No container name given and none could be auto-detected (not in a git repo?). Usage: machinen sync <container>`);
    process.exit(1);
  }
  if (!containerExists(containerName)) {
    console.error(`[ERROR] Container "${containerName}" not found in Docker.`);
    process.exit(1);
  }

  // Validate registry auth at startup
  let registry;
  try {
    const { url } = getRegistry();
    registry = url;
  } catch (err) {
    console.error(`[ERROR] Registry auth failed: ${err.message}`);
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

    // Capture bind mounts and commit the running container (mirrors cmdFreeze
    // but does NOT stop the original container).
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const config = captureContainerConfig(info);
    const commitImage = `${containerName}-sync-committed`;

    // Extract bind-mounted files while the container is still running
    const binds = [...new Set([
      ...(config.Binds || []).map(b => b.split(":")[1]),
      ...(info.Mounts || []).filter(m => m.Type === "bind").map(m => m.Destination),
    ].filter(Boolean))];
    const workspaceTmpDir = binds.length ? fs.mkdtempSync(path.join(os.tmpdir(), "machinen-sync-ws-")) : null;
    const savedBinds = [];
    for (const containerPath of binds) {
      const tarName = `bind-${containerPath.replace(/\//g, "_")}.tar`;
      const bindTarPath = path.join(workspaceTmpDir, tarName);
      try {
        execSync(`docker cp ${containerName}:${containerPath} - > ${bindTarPath}`, {
          stdio: ["pipe", "pipe", "pipe"], shell: true,
        });
        savedBinds.push({ containerPath, tarPath: bindTarPath });
      } catch {
        // Skip mounts that can't be copied (sockets, etc.)
      }
    }

    // Commit the running container to capture writable-layer filesystem state
    execSync(`docker commit ${containerName} ${commitImage}`, { stdio: "pipe" });

    // Bake bind-mounted files into the committed image using a temp container
    const cleanName = `${containerName}-sync-clean`;
    if (savedBinds.length > 0) {
      try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
      execSync([
        "docker run -d",
        `--name ${cleanName}`,
        "--entrypoint sleep",
        commitImage,
        "infinity",
      ].join(" "), { stdio: "pipe" });
      for (const { containerPath, tarPath: bindTarPath } of savedBinds) {
        const parent = path.posix.dirname(containerPath);
        execSync(`cat ${bindTarPath} | docker cp - ${cleanName}:${parent}`, {
          stdio: ["pipe", "pipe", "pipe"], shell: true,
        });
      }
      execSync(`docker commit ${cleanName} ${commitImage}`, { stdio: "pipe" });
      execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" });
    }
    if (workspaceTmpDir) fs.rmSync(workspaceTmpDir, { recursive: true, force: true });

    // Checkpoint the original container directly to preserve the real process tree.
    // exit=false keeps the container running for continued use.
    const { containerId, checkpointId } = await createCheckpoint(containerName, { exit: false });
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

      syncLog("INFO", `Sync complete. Tag: ${checkpointId}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      try { execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" }); } catch {}
      try { execSync(`docker rmi ${commitImage}`, { stdio: "pipe" }); } catch {}
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
  args.containerExplicit = !!containerOrName;
  args.name = args.name || args.container;

  const commands = {
    up: cmdUp,
    freeze: (a) => cmdFreeze(a.container, a),
    restore: cmdRestore,
    watch: cmdSync,
    open: cmdOpen,
    logs: cmdLogs,
    destroy: cmdDestroy,
  };

  if (!action || !commands[action]) {
    console.log(`Usage: machinen <command> [options]

Commands:
  up [branch]           Start container for branch (default: current branch)
    --file <path>       Path to devcontainer.json (auto-detected from cwd)
    --image <image>     Use a Docker image instead of devcontainer
    --name <name>       Override container name (default: machinen-<branch>)
    --cmd <command>     Override container command (default: sleep infinity)
    --detach            Start container without opening a shell
    --clean             Force reinstall of CRIU from source

  freeze [name]         Checkpoint, push to registry, stop container
    --keep-alive        Don't stop the container (live snapshot)
    --clean             Force reinstall of CRIU from source
  restore [name]        Restore container from checkpoint
    --local             Restore locally into <name>-restored
    --remote            Provision server and restore remotely (default)
    --clean             Force reinstall of CRIU from source
  watch [name]          Daemon: sync container + migrate on sleep/wake
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

Registry: ghcr.io via gh CLI (default), or set MACHINEN_REGISTRY=<domain> to use a custom registry (e.g. registry.local)`);
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
