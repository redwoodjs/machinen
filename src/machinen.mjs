#!/usr/bin/env node

import { execSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  docker,
  dockerExec,
  shellQuote,
  prepareCheckpoint,
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
  sshScript,
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

async function cmdRestore(args) {
  const containerName = args.container;
  const { url: registry } = getRegistry();
  const prefix = `${registry}/machinen/${containerName}`;
  const imageTag = `${prefix}:latest`;

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

async function cmdUp(args) {
  const cwd = args.cwd || process.cwd();
  const repoRoot = detectRepoRoot(cwd);

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

  await checkPrerequisites(docker);

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

    // Default command is sleep infinity (keeps container alive for exec)
    const cmd = args.cmd ? args.cmd.split(" ") : ["sleep", "infinity"];
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
          await sendTelegram(`Your machine is running on Hetzner at ${remoteIp}`);
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
        await sendTelegram("Your machine is back on your laptop.");
      } catch (err) {
        console.error("Wake migration failed:", err.message);
      }
    },
  });

  // Open interactive shell
  if (args.image) {
    console.log(`\nConnecting to container...\n`);
    const shell = spawn("docker", ["exec", "-it", containerName, "/bin/bash"], { stdio: "inherit" });

    await new Promise((resolve) => {
      shell.on("exit", async () => {
        console.log("\nShell exited. Cleaning up...");
        watcher.stop();
        if (remoteIp) destroyServer(containerName);
        resolve();
      });
    });
  } else {
    const configPath = path.join(repoRoot, args.file || detectDevcontainerFile(repoRoot));
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
        if (remoteIp) destroyServer(containerName);
        resolve();
      });
    });
  }
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
      const status = dockerExec(["inspect", "--format", "{{.State.Status}}", name]).trim();
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

  freeze [name]         Checkpoint, package as image, push to registry
  restore [name]        Restore container from checkpoint
    --local             Restore locally into <name>-restored
    --remote            Provision server and restore remotely (default)
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
