#!/usr/bin/env node

import { spawnSync, spawn } from "node:child_process";
import {
  freeze,
  restore,
  up,
  destroy,
  migrate,
  discover,
  getShellArgs,
  status,
  logs,
  syncOnce,
  createSyncDaemon,
  currentContainerName,
  containerExists,
  ensureDiND,
  getDiNDHost,
  reconnectDocker,
  getRegistry,
  createPowerWatcher,
  cloudInit,
} from "@machine/sdk";

// --- arg parsing ---

function parseArgs(argv): Record<string, any> & { _positional: string[] } {
  const args: Record<string, any> & { _positional: string[] } = { _positional: [] };
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

// --- onProgress callback for CLI output ---

function cliProgress(event, data) {
  switch (event) {
    case "freeze-start":
      console.log(`Freezing ${data.containerName}...`);
      break;
    case "freeze-complete":
      console.log(`Frozen: ${data.tag}`);
      break;
    case "restore-start":
      console.log(
        `Restoring ${data.containerName} ${data.target === "local" ? "locally" : "remotely"} from ${data.imageTag}...`,
      );
      break;
    case "restore-complete":
      if (data.target === "local") {
        console.log(`\nRestored as: ${data.restoredName}`);
        console.log(`Shell: machinen open`);
      } else {
        console.log(`\nServer: ${data.ip}`);
        console.log(`Shell: machinen open --remote`);
      }
      break;
    case "sync-warning":
      console.warn(`[WARN] ${data.message}`);
      break;
    case "up-start":
      if (data.image) {
        console.log(`Starting ${data.containerName} from image ${data.image}...`);
      } else {
        console.log(`Starting ${data.containerName} from ${data.file}...`);
      }
      break;
    case "up-complete":
      console.log(`Container: ${data.containerName}`);
      console.log(`Image prefix: ${data.imagePrefix}`);
      break;
    case "warning":
      console.warn(`Warning: ${data.message}`);
      break;
    case "migrate-start":
      console.log(
        `\n${data.direction === "to-remote" ? "Sleep" : "Wake"} detected — migrating ${data.direction === "to-remote" ? "to remote" : "back to local"}...`,
      );
      break;
    case "migrate-provisioning":
      console.log("Provisioning remote server...");
      break;
    case "migrate-complete":
      if (data.direction === "to-remote") {
        console.log(`Remote restore complete: ${data.ip}`);
      } else {
        console.log("Local restore complete.");
      }
      break;
    case "sync-start":
      console.log(`Syncing ${data.containerName}...`);
      break;
    case "sync-complete":
      console.log(`Sync complete. Tag: ${data.tag}`);
      break;
    case "sync-scheduled":
      console.log(`Next sync in ${data.nextInSeconds}s`);
      break;
    case "sync-skipped":
      console.warn(`[WARN] ${data.reason}`);
      break;
  }
}

// --- CLI command handlers ---

async function cmdFreeze(args) {
  const result = await freeze(args.container, {
    clean: args.clean,
    keepAlive: args["keep-alive"],
    onProgress: cliProgress,
  });
  return result;
}

async function cmdRestore(args) {
  const result = await restore(args.container, {
    local: args.local,
    remote: args.remote,
    clean: args.clean,
    containerExplicit: args.containerExplicit,
    onProgress: cliProgress,
  });
  return result;
}

async function cmdUp(args) {
  const result = await up({
    cwd: args.cwd,
    branch: args._positional?.[1],
    name: args.name,
    file: args.file,
    image: args.image,
    cmd: args.cmd,
    detach: args.detach,
    clean: args.clean,
    onProgress: cliProgress,
  });

  if (result.detach) {
    console.log(`Container ${result.containerName} is running (detached).`);
    return;
  }

  // Start power watcher for sleep/wake handoff
  let remoteIp = null;
  const { url: registry } = getRegistry();

  console.log("Watching for sleep/wake events...");
  const watcher = createPowerWatcher({
    onSleep: async () => {
      try {
        const migResult = await migrate(result.containerName, {
          direction: "to-remote",
          registry,
          imagePrefix: result.imagePrefix,
          onProgress: cliProgress,
        });
        remoteIp = migResult.ip;
      } catch (err) {
        console.error("Sleep migration failed:", err.message);
      }
    },

    onWake: async () => {
      if (!remoteIp) {
        console.log("No remote container to restore from.");
        return;
      }

      try {
        await migrate(result.containerName, {
          direction: "to-local",
          registry,
          imagePrefix: result.imagePrefix,
          remoteIp,
          onProgress: cliProgress,
        });
        remoteIp = null;
      } catch (err) {
        console.error("Wake migration failed:", err.message);
      }
    },
  });

  // Open interactive shell
  const shellInfo = getShellArgs(result.containerName, { host: "local" });

  console.log(`\nConnecting to container...\n`);
  const shell = spawn(shellInfo.command, shellInfo.args, { stdio: "inherit" });

  await new Promise<void>((resolve) => {
    shell.on("exit", async () => {
      console.log("\nShell exited. Cleaning up...");
      watcher.stop();
      if (remoteIp) {
        await destroy(result.containerName, { remote: true });
      }
      resolve();
    });
  });
}

async function cmdOpen(args) {
  const containerName = args.container;

  if (!args.local && !args.remote) {
    console.error(
      "Specify --local or --remote.\n  machinen open --local\n  machinen open --remote",
    );
    process.exit(1);
  }

  if (args.local) {
    await ensureDiND();
    const diNDHost = getDiNDHost();
    process.env.DOCKER_HOST = diNDHost;
    const { hostname, port } = new URL(diNDHost);
    reconnectDocker(hostname, parseInt(port, 10));
  }

  if (args.remote) {
    const ip = typeof args.remote === "string" ? args.remote : undefined;
    const shellInfo = getShellArgs(containerName, { host: "remote", ip });
    const shell = spawnSync(shellInfo.command, shellInfo.args, { stdio: "inherit" });
    process.exit(shell.status || 0);
  }

  try {
    const shellInfo = getShellArgs(containerName, { host: "local" });
    console.log(`Opening shell in local container...`);
    const shell = spawnSync(shellInfo.command, shellInfo.args, { stdio: "inherit" });
    process.exit(shell.status || 0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function cmdLogs(args) {
  const containerName = args.container;
  if (!containerName) {
    const { hosts, containers } = discover();
    const machines: any[] = [...containers, ...hosts];
    if (machines.length === 0) {
      console.log("No active machines.");
      return;
    }
    for (const m of machines) {
      console.log(`${m.name}  ${m.location}  ${m.ip || ""}  ${m.status || ""}`);
    }
    return;
  }
  logs(containerName);
}

async function cmdDestroy(args) {
  const name = args.name || args.container;
  const results = await destroy(name, { local: args.local, remote: args.remote });

  for (const n of results.removedLocal) {
    console.log(`Removed local container ${n}.`);
  }
  for (const n of results.destroyedRemote) {
    console.log(`Destroyed remote server ${n}.`);
  }
  if (results.removedLocal.length === 0 && results.destroyedRemote.length === 0) {
    if (args.local) {
      console.log(`No local containers found for ${name}.`);
    } else {
      console.log(`Nothing found for ${name}.`);
    }
  }
}

function cmdStatus(args) {
  const containerName = args.container;
  const result = status(containerName);

  console.log(`Container:  ${result.containerName}`);
  console.log(`Local:      ${result.local}`);
  if (result.remote) {
    console.log(`Remote:     ${result.remote.ip} (${result.remote.status})`);
  } else {
    console.log(`Remote:     none`);
  }

  if (result.sync) {
    console.log(
      `Sync:       ${result.sync.running ? `running (PID ${result.sync.pid})` : "not running"}`,
    );

    if (result.sync.lastSync) {
      const ageMs = Date.now() - new Date(result.sync.lastSync).getTime();
      const ageMin = Math.round(ageMs / 60000);
      const ago = ageMin < 1 ? "just now" : `${ageMin}m ago`;
      const ok = result.sync.lastSyncSuccess ? "success" : "failed";
      console.log(`Last sync:  ${ago} (${ok})`);
    }

    if (result.sync.syncCount != null) {
      const failures = result.sync.consecutiveFailures || 0;
      console.log(
        `Syncs:      ${result.sync.syncCount} total${failures > 0 ? `, ${failures} consecutive failures` : ""}`,
      );
    }
  } else {
    console.log(`Sync:       no status file found`);
  }

  console.log(`Registry:   ${result.registry}`);

  if (result.images.length > 0) {
    console.log(`\nRecent images:`);
    for (const v of result.images) {
      const tags = (v.tags || []).join(", ") || "(untagged)";
      const updated = new Date(v.updated).toLocaleString();
      console.log(`  ${tags}  ${updated}`);
    }
  } else {
    console.log(`\nNo images found in registry.`);
  }
}

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
  const rawInterval =
    args.interval === undefined
      ? process.env.MACHINEN_SYNC_INTERVAL || String(DEFAULT_INTERVAL_S)
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

  // Connect to the DinD inner daemon
  try {
    const diNDHost = getDiNDHost();
    process.env.DOCKER_HOST = diNDHost;
    const { hostname, port } = new URL(diNDHost);
    reconnectDocker(hostname, parseInt(port, 10));
  } catch {}

  const containerName = args.container || currentContainerName();
  if (!containerName) {
    console.error(
      `[ERROR] No container name given and none could be auto-detected (not in a git repo?). Usage: machinen sync <container>`,
    );
    process.exit(1);
  }
  if (!containerExists(containerName)) {
    console.error(`[ERROR] Container "${containerName}" not found in Docker.`);
    process.exit(1);
  }

  let registry;
  try {
    const { url } = getRegistry();
    registry = url;
  } catch (err) {
    console.error(`[ERROR] Registry auth failed: ${err.message}`);
    process.exit(1);
  }

  function syncLog(level, msg) {
    const ts = new Date().toISOString();
    if (level === "ERROR" || level === "WARN") {
      process.stderr.write(`[${ts}] [${level}] ${msg}\n`);
    } else {
      process.stdout.write(`[${ts}] [${level}] ${msg}\n`);
    }
  }

  // --once: single sync and exit
  if (once) {
    try {
      await syncOnce(containerName, {
        registry,
        onProgress: (event, data) => {
          if (event === "sync-start") {
            syncLog("INFO", `Syncing ${data.containerName}...`);
          }
          if (event === "sync-complete") {
            syncLog("INFO", `Sync complete. Tag: ${data.tag}`);
          }
        },
      });
      process.exit(0);
    } catch (err) {
      syncLog("ERROR", `Sync failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Daemon mode
  syncLog("INFO", `Starting sync daemon`);
  syncLog("INFO", `  Container: ${containerName}`);
  syncLog("INFO", `  Registry:  ${registry}`);
  syncLog("INFO", `  Interval:  ${intervalS}s`);
  syncLog("INFO", `  PID:       ${process.pid}`);

  const daemon = createSyncDaemon(containerName, {
    registry,
    interval: intervalS,
    onProgress: (event, data) => {
      if (event === "sync-start") {
        syncLog("INFO", `Syncing ${data.containerName}...`);
      }
      if (event === "sync-complete") {
        syncLog("INFO", `Sync complete. Tag: ${data.tag}`);
      }
      if (event === "sync-scheduled") {
        syncLog("INFO", `Next sync in ${data.nextInSeconds}s`);
      }
      if (event === "sync-skipped") {
        syncLog("WARN", data.reason);
      }
    },
    onError: (err, info) => {
      if (info?.fatal) {
        syncLog("ERROR", err.message + " Exiting.");
        daemon.stop();
        process.exit(1);
      }
      if (info?.isAuthError) {
        syncLog("ERROR", `Sync failed (auth error): ${err.message}`);
        syncLog("WARN", "Run 'gh auth refresh -s write:packages' to fix authentication.");
      } else {
        syncLog("ERROR", `Sync failed: ${err.message}`);
      }
    },
  });

  function handleShutdown(signal) {
    syncLog("INFO", `Received ${signal}. Shutting down.`);
    daemon.stop();
    syncLog("INFO", "Sync daemon stopped.");
    process.exit(0);
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  // Keep process alive
  await new Promise(() => {});
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
    freeze: cmdFreeze,
    restore: cmdRestore,
    watch: cmdSync,
    open: cmdOpen,
    status: cmdStatus,
    logs: cmdLogs,
    destroy: cmdDestroy,
    "setup-script": () => {
      process.stdout.write(cloudInit());
    },
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
    --remote [ip]       Restore remotely (provision Hetzner VM, or target IP)
    --clean             Force reinstall of CRIU from source
  watch [name]          Daemon: sync container + migrate on sleep/wake
    --interval <s>      Sync interval in seconds (default: 300, minimum: 30)
    --once              Run a single sync and exit
  open [name]           Open shell in container
    --local             Open shell in local container
    --remote [ip]       Open shell on remote server (or target IP)
  status [name]         Show sync state and recent registry images
  logs [name]           Tail remote container logs (or list machines)
  destroy [name]        Tear down container (both local and remote)
    --local             Only remove local containers
    --remote [ip]       Only destroy remote container (or on target IP)
  setup-script          Print setup script for self-hosted machines

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

  if ((action === "freeze" || action === "restore" || action === "status") && !args.container) {
    console.error(
      `Container name required (not in a git repo?). Usage: machinen ${action} <container>`,
    );
    process.exit(1);
  }

  await commands[action](args);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
