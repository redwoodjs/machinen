#!/usr/bin/env node

import { execSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  docker,
  createCheckpoint,
  extractCheckpointFiles,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
} from "./docker.mjs";
import { checkPrerequisites } from "./preflight.mjs";
import {
  loadState,
  saveState,
  deleteState,
  listState,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
  getProvider,
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
  const { containerId, checkpointId, config } = await createCheckpoint(containerName);
  console.log(`Checkpoint: ${checkpointId}`);

  console.log("Extracting checkpoint files...");
  const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

  try {
    // Use existing imagePrefix from state, or fall back to container name
    const state = loadState(containerName);
    const prefix = state.imagePrefix || `${registry}/machinen/${containerName}`;
    const tag = `${prefix}:${checkpointId}`;
    const latestTag = `${prefix}:latest`;

    buildCheckpointImage(tarPath, config.Image, config, checkpointId, tag);
    execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });

    pushImage(tag);
    pushImage(latestTag);

    saveState(containerName, { tag, latestTag, checkpointId, registry });
    console.log(`Frozen: ${tag}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- restore ---

async function cmdRestore(containerName) {
  const state = loadState(containerName);
  const { url: registry } = getRegistry();
  const prefix = state.imagePrefix || `${registry}/machinen/${containerName}`;
  const imageTag = state.latestTag || `${prefix}:latest`;

  const ip = await provisionServer({ name: `machinen-${containerName}`, stateKey: containerName });
  remoteDockerLogin(ssh, ip);
  remoteRestore(ip, containerName, imageTag, registry);

  console.log(`\nServer: ${ip}`);
  console.log(`Live logs: machinen logs ${containerName}`);
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

function detectRepoRoot(cwd) {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return cwd;
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
  let branch;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot, stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    branch = "main";
  }
  // Image tag: ghcr.io/<user>/machinen/<repo>/<branch>
  const imagePrefix = `${registry}/machinen/${repoName}/${branch}`;
  const containerName = args.name || `machinen-${repoName}-${branch}`;

  await checkPrerequisites(docker);

  // Step 1: Start local devcontainer
  console.log(`Starting local devcontainer from ${file}...`);
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

  // Get the container ID/name that devcontainer created
  const dcContainer = execSync(
    `docker ps --filter "label=devcontainer.local_folder=${repoRoot}" --format "{{.Names}}"`,
    { stdio: "pipe", encoding: "utf-8" }
  ).trim();

  if (!dcContainer) {
    throw new Error("Could not find devcontainer. Is it running?");
  }

  console.log(`Devcontainer: ${dcContainer}`);
  console.log(`Image prefix: ${imagePrefix}`);
  saveState(dcContainer, { registry, repoRoot, file, imagePrefix, repoName, branch });

  // Step 2: Start power watcher for sleep/wake handoff
  const serverName = `machinen-${dcContainer}`;
  let remoteIp = null;

  console.log("Watching for sleep/wake events...");
  const watcher = createPowerWatcher({
    onSleep: async ({ canDelaySleep }) => {
      console.log("\nSleep detected — migrating to remote...");

      try {
        // Freeze local container (stops it)
        const { containerId, checkpointId, config } = await createCheckpoint(dcContainer);
        const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

        try {
          const tag = `${imagePrefix}:${checkpointId}`;
          const latestTag = `${imagePrefix}:latest`;
          buildCheckpointImage(tarPath, config.Image, config, checkpointId, tag);
          execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });
          pushImage(tag);
          pushImage(latestTag);

          // Provision server now (only when we actually need it)
          console.log("Provisioning remote server...");
          remoteIp = await provisionServer({ name: serverName, stateKey: dcContainer });
          remoteDockerLogin(ssh, remoteIp);

          remoteRestore(remoteIp, dcContainer, latestTag, registry);
          saveState(dcContainer, { tag, latestTag, checkpointId, registry, ip: remoteIp, serverName, mode: "remote" });
          await sendTelegram(`Your machine is running on Hetzner at ${remoteIp}`);
          console.log(`Remote restore complete: ${remoteIp}`);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.error("Sleep migration failed:", err.message);
      }
    },

    onWake: async () => {
      console.log("\nWake detected — migrating back to local...");
      const state = loadState(dcContainer);

      if (state.mode !== "remote" || !state.ip) {
        console.log("No remote container to restore from.");
        return;
      }

      try {
        const { latestTag } = remoteFreeze(state.ip, dcContainer, registry);

        pullImage(latestTag);
        restoreLocally(latestTag, dcContainer);

        console.log("Destroying remote server...");
        await destroyServer(serverName, dcContainer);
        remoteIp = null;

        saveState(dcContainer, { registry, repoRoot, file, mode: "local" });

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
      const state = loadState(dcContainer);
      if (state.ip) {
        await destroyServer(serverName, dcContainer);
      }
      resolve();
    });
  });
}

// --- logs ---

function cmdLogs(args) {
  const containerName = args.container;
  if (!containerName) {
    const all = listState();
    if (Object.keys(all).length === 0) {
      console.log("No active machines.");
      return;
    }
    for (const [name, state] of Object.entries(all)) {
      console.log(`${name}  mode=${state.mode || "local"}  ip=${state.ip || "-"}`);
    }
    return;
  }

  const state = loadState(containerName);
  if (!state.ip) throw new Error(`No server for ${containerName}. Is it running remotely?`);
  ssh(state.ip, `docker logs -f ${containerName}`);
}

// --- destroy ---

async function cmdDestroy(args) {
  const name = args.name || args.container;
  if (!name) {
    const all = listState();
    for (const [key, state] of Object.entries(all)) {
      if (state.serverName) {
        await destroyServer(state.serverName, key);
      }
    }
    return;
  }
  const state = loadState(name);
  await destroyServer(state.serverName || `machinen-${name}`, name);
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

  args.container = containerOrName;
  args.name = args.name || containerOrName;

  const commands = {
    up: cmdUp,
    freeze: (a) => cmdFreeze(a.container),
    restore: (a) => cmdRestore(a.container),
    logs: cmdLogs,
    destroy: cmdDestroy,
  };

  if (!action || !commands[action]) {
    console.log(`Usage: machinen <command> [options]

Commands:
  up [options]          Start local devcontainer with sleep/wake cloud handoff
    --file <path>       Path to devcontainer.json (auto-detected from cwd)
    --name <name>       Container name (default: derived from directory)

  freeze <container>    Checkpoint, package as image, push to registry
  restore <container>   Provision server, pull image, restore container
  logs [container]      Tail remote container logs (or list containers)
  destroy [name]        Tear down the remote server

Cloud provider (default: hetzner):
  hcloud CLI            Install: brew install hcloud
                        Auth: hcloud context create machinen

Environment:
  HCLOUD_TOKEN          Hetzner API token (alternative to hcloud context auth)
  TELEGRAM_BOT_TOKEN    Telegram bot token (optional, for notifications)
  TELEGRAM_CHAT_ID      Telegram chat ID (optional, for notifications)

Registry: Uses ghcr.io via authenticated gh CLI (run 'gh auth login' first)`);
    process.exit(action ? 1 : 0);
  }

  if ((action === "freeze" || action === "restore") && !args.container) {
    console.error(`Container name required. Usage: machinen ${action} <container>`);
    process.exit(1);
  }

  await commands[action](args);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
