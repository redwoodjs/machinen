import { execSync, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  docker,
  dockerExec,
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
} from "./docker";
import { checkPrerequisites } from "./preflight";
import { getDiNDHost } from "./dind";
import {
  listMachines,
  provisionServer,
  destroyServer,
  remoteRestore,
  remoteFreeze,
  ssh,
  sshScript,
  SSH_OPTS,
} from "./cloud";
import { getRegistry, ensureDockerLogin, remoteDockerLogin } from "./registry";

// --- utility helpers ---

export function currentBranch() {
  try {
    return execSync("git symbolic-ref --short HEAD", { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function sanitizeBranch(branch) {
  return branch.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function currentContainerName() {
  const branch = currentBranch();
  return branch ? `machinen-${sanitizeBranch(branch)}` : null;
}

export function gitRoot(cwd?) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function detectDevcontainerFile(cwd) {
  const candidates = [".devcontainer/devcontainer.json", ".devcontainer.json"];

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

export function syncStatusPath(containerName) {
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

export function writeSyncStatus(statusPath, data) {
  const tmp = statusPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, statusPath);
}

export function isAuthError(err) {
  const msg = err?.message || String(err);
  return /write:packages|unauthorized|authentication required|no basic auth credentials|requested access to the resource is denied|denied:|access denied|401\b|403\b/i.test(
    msg,
  );
}

export function containerExists(name) {
  try {
    execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkSyncStatus(containerName) {
  let statusPath = null;
  const root = gitRoot();
  if (root) {
    const candidate = path.join(root, ".machinen", "sync-status.json");
    if (fs.existsSync(candidate)) {
      statusPath = candidate;
    }
  }
  if (!statusPath) {
    const candidate = path.join(os.homedir(), ".machinen", containerName, "sync-status.json");
    if (fs.existsSync(candidate)) {
      statusPath = candidate;
    }
  }
  if (!statusPath) {
    return null;
  }

  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
  } catch {
    return null;
  }

  const result = { status, warnings: [] };

  if (status.lastSync) {
    const ageMs = Date.now() - new Date(status.lastSync).getTime();
    const ageMin = Math.round(ageMs / 60000);
    if (ageMs > 10 * 60 * 1000) {
      result.warnings.push(`Last sync was ${ageMin} minute(s) ago. Image may be stale.`);
    }
  }

  if (status.pid != null) {
    let daemonRunning = false;
    try {
      process.kill(status.pid, 0);
      daemonRunning = true;
    } catch {}
    if (!daemonRunning) {
      result.warnings.push(`Sync daemon (PID ${status.pid}) is not currently running.`);
    }
  }

  return result;
}

// --- freeze ---

export async function freeze(
  containerName,
  { clean, keepAlive, onProgress }: Record<string, any> = {},
) {
  await checkPrerequisites(docker, { clean });
  ensureDockerLogin();

  const { url: registry } = getRegistry();

  onProgress?.("freeze-start", { containerName });

  const { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath } =
    await prepareCheckpoint(containerName, { stop: !keepAlive });

  try {
    const prefix = `${registry}/machinen/${containerName}`;
    const tag = `${prefix}:${checkpointId}`;
    const latestTag = `${prefix}:latest`;
    const baseTag = `${prefix}:base-${checkpointId}`;
    const baseLatestTag = `${prefix}:base`;

    dockerExec(["tag", commitImage, baseTag]);
    dockerExec(["tag", commitImage, baseLatestTag]);
    pushImage(baseTag);
    pushImage(baseLatestTag);

    buildCheckpointImage(
      tarPath,
      commitImage,
      config,
      checkpointId,
      tag,
      [],
      baseLatestTag,
      containerId,
    );
    dockerExec(["tag", tag, latestTag]);

    pushImage(tag);
    pushImage(latestTag);

    onProgress?.("freeze-complete", { tag, checkpointId });
    return { tag, checkpointId };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      dockerExec(["rm", "-f", cleanName]);
    } catch {}
    try {
      dockerExec(["rmi", commitImage]);
    } catch {}
  }
}

// --- restore ---

export async function restore(
  containerName,
  { local, remote, clean, containerExplicit, onProgress }: Record<string, any> = {},
) {
  const { url: registry, isLocal } = getRegistry();
  const prefix = `${registry}/machinen/${containerName}`;
  const imageTag = `${prefix}:latest`;

  if (isLocal && local) {
    ensureDockerLogin();
    const slashIdx = imageTag.indexOf("/");
    const host = imageTag.slice(0, slashIdx);
    const rest = imageTag.slice(slashIdx + 1);
    const colonIdx = rest.lastIndexOf(":");
    const repo = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
    const tag = colonIdx >= 0 ? rest.slice(colonIdx + 1) : "latest";
    const localPort = host.includes(":") ? host.split(":")[1] : "80";
    try {
      const res = await fetch(`http://localhost:${localPort}/v2/${repo}/manifests/${tag}`, {
        method: "HEAD",
      });
      if (res.status === 404) {
        if (!containerExplicit) {
          const branch = currentBranch();
          throw new Error(
            `Container name was auto-detected from git branch "${branch}".\n` +
              `No frozen image found for "${containerName}" in the registry.\n` +
              `To restore a specific container, pass its name explicitly:\n` +
              `  machinen restore --local machinen-main`,
          );
        }
        throw new Error(
          `No frozen image found for "${containerName}" in the registry.\n` +
            `Check that this container has been frozen and pushed.`,
        );
      }
    } catch (err) {
      if (err.message.includes("No frozen image found")) {
        throw err;
      }
      // Registry unreachable — let checkPrerequisites and the pull surface the error.
    }
  }

  await checkPrerequisites(docker, { clean: !!clean });

  const syncResult = checkSyncStatus(containerName);
  if (syncResult) {
    for (const w of syncResult.warnings) {
      onProgress?.("sync-warning", { message: w });
    }
  }

  if (!local && !remote) {
    throw new Error(
      "Specify --local or --remote.\n  machinen restore --local\n  machinen restore --remote",
    );
  }

  if (local) {
    onProgress?.("restore-start", { containerName, imageTag, target: "local" });
    pullImage(imageTag);
    const restoredName = `${containerName}-restored`;
    restoreLocally(imageTag, restoredName);
    onProgress?.("restore-complete", { restoredName, target: "local" });
    return { restoredName };
  }

  onProgress?.("restore-start", { containerName, imageTag, target: "remote" });
  // If remote is an IP address, use it directly; otherwise provision via cloud provider
  const ip = typeof remote === "string" ? remote : await provisionServer({ name: containerName });
  remoteDockerLogin(sshScript, ip);
  remoteRestore(ip, containerName, imageTag, registry);
  onProgress?.("restore-complete", { ip, target: "remote" });
  return { ip };
}

// --- up ---

export async function up({
  cwd,
  branch,
  name,
  file,
  image,
  cmd,
  detach,
  clean,
  onProgress,
}: Record<string, any> = {}) {
  const effectiveCwd = cwd || process.cwd();
  const repoRoot = gitRoot(effectiveCwd) || effectiveCwd;

  ensureDockerLogin();
  const { url: registry } = getRegistry();

  const effectiveBranch = branch || currentBranch() || "main";
  const safeBranch = sanitizeBranch(effectiveBranch);
  const repoName = path.basename(repoRoot);
  const imagePrefix = `${registry}/machinen/${repoName}/${safeBranch}`;

  const containerName = name
    ? name.startsWith("machinen-")
      ? name
      : `machinen-${name}`
    : `machinen-${safeBranch}`;

  await checkPrerequisites(docker, { clean: !!clean });

  if (image) {
    onProgress?.("up-start", { containerName, image });

    try {
      dockerExec(["rm", "-f", containerName]);
    } catch {}

    const runArgs = [
      "run",
      "-d",
      "--name",
      containerName,
      "--security-opt",
      "seccomp=unconfined",
      "--network",
      "host",
    ];

    const effectiveCmd = cmd
      ? cmd.split(" ")
      : [
          "sh",
          "-c",
          "command -v tmux >/dev/null || (apk add -q tmux 2>/dev/null || apt-get -qq install -y tmux 2>/dev/null); tmux new-session -d -s machinen 2>/dev/null || true; exec sleep infinity",
        ];
    runArgs.push(image, ...effectiveCmd);

    dockerExec(runArgs, { stdio: "inherit" });
    onProgress?.("up-complete", { containerName, imagePrefix });
  } else {
    const effectiveFile = file || detectDevcontainerFile(repoRoot);

    if (!effectiveFile) {
      throw new Error(
        "No devcontainer.json found. Specify with --file <path> or use --image <image>\n" +
          "  e.g., machinen up --file .devcontainer/devcontainer.json\n" +
          "  e.g., machinen up --image ubuntu:latest",
      );
    }

    const configPath = path.join(repoRoot, effectiveFile);

    const REQUIRED_RUN_ARGS = ["--security-opt", "seccomp=unconfined", "--network", "host"];
    let effectiveConfigPath = configPath;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const existing = raw.runArgs || [];
      const missing = REQUIRED_RUN_ARGS.filter((a) => !existing.includes(a));
      if (missing.length > 0) {
        const merged = { ...raw, runArgs: [...existing, ...missing] };
        const tmpConfig = path.join(os.tmpdir(), `machinen-devcontainer-${Date.now()}.json`);
        fs.writeFileSync(tmpConfig, JSON.stringify(merged, null, 2));
        effectiveConfigPath = tmpConfig;
      }
    } catch {}

    onProgress?.("up-start", { containerName, file: effectiveFile });
    const upResult = spawnSync(
      "npx",
      [
        "devcontainer",
        "up",
        "--workspace-folder",
        repoRoot,
        "--config",
        effectiveConfigPath,
        "--additional-features",
        '{"ghcr.io/devcontainers/features/docker-outside-of-docker:1":{}}',
        "--remove-existing-container",
      ],
      { stdio: "inherit" },
    );

    if (effectiveConfigPath !== configPath) {
      try {
        fs.unlinkSync(effectiveConfigPath);
      } catch {}
    }

    if (upResult.status !== 0) {
      throw new Error("devcontainer up failed");
    }

    const dcContainerOriginal = dockerExec([
      "ps",
      "--filter",
      `label=devcontainer.local_folder=${repoRoot}`,
      "--format",
      "{{.Names}}",
    ]).trim();

    if (!dcContainerOriginal) {
      throw new Error("Could not find devcontainer. Is it running?");
    }

    if (dcContainerOriginal !== containerName) {
      try {
        dockerExec(["rm", "-f", containerName]);
      } catch {}
      dockerExec(["rename", dcContainerOriginal, containerName]);
    }

    try {
      ensureTmuxSession(containerName, { user: resolveContainerUser(containerName) });
    } catch (err: any) {
      onProgress?.("warning", { message: `Could not start tmux session: ${err.message}` });
    }

    onProgress?.("up-complete", { containerName, imagePrefix });
  }

  return { containerName, imagePrefix, registry, detach: !!detach };
}

// --- migrate ---

export async function migrate(
  containerName,
  { direction, registry: registryUrl, imagePrefix, onProgress }: Record<string, any> = {},
) {
  const registry = registryUrl || getRegistry().url;
  const prefix = imagePrefix || `${registry}/machinen/${containerName}`;

  if (direction === "to-remote") {
    onProgress?.("migrate-start", { direction: "to-remote" });

    const { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath } =
      await prepareCheckpoint(containerName, { stop: true });

    try {
      const tag = `${prefix}:${checkpointId}`;
      const latestTag = `${prefix}:latest`;
      const baseTag = `${prefix}:base-${checkpointId}`;
      const baseLatestTag = `${prefix}:base`;

      dockerExec(["tag", commitImage, baseTag]);
      dockerExec(["tag", commitImage, baseLatestTag]);
      pushImage(baseTag);
      pushImage(baseLatestTag);

      buildCheckpointImage(
        tarPath,
        commitImage,
        config,
        checkpointId,
        tag,
        [],
        baseLatestTag,
        containerId,
      );
      dockerExec(["tag", tag, latestTag]);
      pushImage(tag);
      pushImage(latestTag);

      onProgress?.("migrate-provisioning", {});
      const ip = await provisionServer({ name: containerName });
      remoteDockerLogin(sshScript, ip);
      remoteRestore(ip, containerName, latestTag, registry);

      onProgress?.("migrate-complete", { direction: "to-remote", ip });
      return { ip };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      try {
        dockerExec(["rm", "-f", cleanName]);
      } catch {}
      try {
        dockerExec(["rmi", commitImage]);
      } catch {}
    }
  }

  if (direction === "to-local") {
    onProgress?.("migrate-start", { direction: "to-local" });

    const { remoteIp } = arguments[1];
    if (!remoteIp) {
      throw new Error("No remote container to restore from.");
    }

    const { latestTag } = remoteFreeze(remoteIp, containerName, registry);
    pullImage(latestTag);
    restoreLocally(latestTag, containerName);

    destroyServer(containerName);

    onProgress?.("migrate-complete", { direction: "to-local" });
    return {};
  }

  throw new Error(`Unknown migration direction: ${direction}`);
}

// --- destroy ---

export async function destroy(name, { local, remote }: Record<string, any> = {}) {
  try {
    const diNDHost = getDiNDHost();
    process.env.DOCKER_HOST = diNDHost;
  } catch {}

  const results = { removedLocal: [], destroyedRemote: [] };

  if (local) {
    for (const n of [name, `${name}-restored`]) {
      try {
        dockerExec(["rm", "-f", n]);
        results.removedLocal.push(n);
      } catch {}
    }
    return results;
  }

  if (remote || !name) {
    // If remote is an IP, just remove the container on that machine (don't destroy the server)
    if (typeof remote === "string") {
      ssh(remote, `docker rm -f ${name} 2>/dev/null || true`);
      results.destroyedRemote.push(name);
      return results;
    }

    if (!name) {
      const machines = listMachines();
      const remotes = machines.filter((m) => m.ip);
      for (const m of remotes) {
        destroyServer(m.name);
        results.destroyedRemote.push(m.name);
      }
      return results;
    }
    destroyServer(name);
    results.destroyedRemote.push(name);
    return results;
  }

  // No flag: destroy both local and remote
  for (const n of [name, `${name}-restored`]) {
    try {
      dockerExec(["rm", "-f", n]);
      results.removedLocal.push(n);
    } catch {}
  }
  try {
    destroyServer(name);
    results.destroyedRemote.push(name);
  } catch {}
  return results;
}

// --- discover ---

export function discover() {
  const machines = listMachines();
  return {
    hosts: machines
      .filter((m) => m.ip)
      .map((m) => ({
        name: m.name,
        ip: m.ip,
        location: m.location,
        status: m.status,
      })),
    containers: machines
      .filter((m) => m.location === "local")
      .map((m) => ({
        name: m.name,
        location: m.location,
        status: m.status,
      })),
  };
}

// --- getShellArgs ---

export function getShellArgs(containerName, { host, ip: remoteIp }: Record<string, any> = {}) {
  if (host === "remote") {
    let ip = remoteIp;
    if (!ip) {
      const machines = listMachines();
      const machine = machines.find((m) => m.name === containerName && m.ip);
      if (!machine) {
        throw new Error(`No remote server found for ${containerName}.`);
      }
      ip = machine.ip;
    }

    const remoteCmd = [
      `META=$(docker inspect --format '{{index .Config.Labels "devcontainer.metadata"}}' ${containerName} 2>/dev/null)`,
      `USER=$(echo "$META" | python3 -c "import sys,json; entries=json.load(sys.stdin); print(next((e['remoteUser'] for e in entries if 'remoteUser' in e), ''))" 2>/dev/null || true)`,
      `[ -z "$USER" ] && USER=$(docker inspect --format '{{.Config.User}}' ${containerName} 2>/dev/null || true)`,
      `USER_FLAG=$([ -n "$USER" ] && echo "--user $USER" || true)`,
      `docker exec -it $USER_FLAG ${containerName} sh -c 'tmux has-session -t machinen 2>/dev/null && exec tmux attach-session -t machinen || exec /bin/bash'`,
    ].join("; ");

    return {
      command: "ssh",
      args: ["-t", ...SSH_OPTS, `root@${ip}`, remoteCmd],
      env: {},
    };
  }

  // Local: try both <name> and <name>-restored
  for (const name of [containerName, `${containerName}-restored`]) {
    try {
      const status = dockerExec(["inspect", "--format", "{{.State.Status}}", name]).trim();
      if (status === "running") {
        const user = resolveContainerUser(name);
        const execArgs = hasTmuxSession(name, undefined, { user: user || undefined })
          ? tmuxAttachArgs(name, { user: user || undefined })
          : (() => {
              const a = ["exec", "-it"];
              if (user) {
                a.push("--user", user);
              }
              a.push(name, "/bin/bash");
              return a;
            })();

        return {
          command: "docker",
          args: execArgs,
          env: process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {},
        };
      }
    } catch {}
  }

  throw new Error(`No running local container found for ${containerName}.`);
}

// --- syncOnce ---

export async function syncOnce(
  containerName,
  { registry: registryUrl, onProgress }: Record<string, any> = {},
) {
  const registry = registryUrl || getRegistry().url;

  onProgress?.("sync-start", { containerName });

  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const config = captureContainerConfig(info);
  const commitImage = `${containerName}-sync-committed`;

  const binds = [
    ...new Set(
      [
        ...(config.Binds || []).map((b) => b.split(":")[1]),
        ...(info.Mounts || []).filter((m) => m.Type === "bind").map((m) => m.Destination),
      ].filter(Boolean),
    ),
  ];
  const workspaceTmpDir = binds.length
    ? fs.mkdtempSync(path.join(os.tmpdir(), "machinen-sync-ws-"))
    : null;
  const savedBinds = [];
  for (const containerPath of binds) {
    const tarName = `bind-${containerPath.replace(/\//g, "_")}.tar`;
    const bindTarPath = path.join(workspaceTmpDir, tarName);
    try {
      execSync(`docker cp ${containerName}:${containerPath} - > ${bindTarPath}`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      savedBinds.push({ containerPath, tarPath: bindTarPath });
    } catch {}
  }

  execSync(`docker commit ${containerName} ${commitImage}`, { stdio: "pipe" });

  const cleanName = `${containerName}-sync-clean`;
  if (savedBinds.length > 0) {
    try {
      execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" });
    } catch {}
    execSync(
      ["docker run -d", `--name ${cleanName}`, "--entrypoint sleep", commitImage, "infinity"].join(
        " ",
      ),
      { stdio: "pipe" },
    );
    for (const { containerPath, tarPath: bindTarPath } of savedBinds) {
      const parent = path.posix.dirname(containerPath);
      execSync(`cat ${bindTarPath} | docker cp - ${cleanName}:${parent}`, {
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    execSync(`docker commit ${cleanName} ${commitImage}`, { stdio: "pipe" });
    execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" });
  }
  if (workspaceTmpDir) {
    fs.rmSync(workspaceTmpDir, { recursive: true, force: true });
  }

  const { containerId, checkpointId } = await createCheckpoint(containerName, { exit: false });
  const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

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

    buildCheckpointImage(
      tarPath,
      commitImage,
      config,
      checkpointId,
      tag,
      [],
      baseLatestTag,
      containerId,
    );
    execSync(`docker tag ${tag} ${latestTag}`, { stdio: "pipe" });
    pushImage(tag);
    pushImage(latestTag);

    onProgress?.("sync-complete", { tag: checkpointId });
    return { tag, checkpointId };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      execSync(`docker rm -f ${cleanName}`, { stdio: "pipe" });
    } catch {}
    try {
      execSync(`docker rmi ${commitImage}`, { stdio: "pipe" });
    } catch {}
  }
}

// --- createSyncDaemon ---

export function createSyncDaemon(
  containerName,
  { registry: registryUrl, interval = 300, onProgress, onError }: Record<string, any> = {},
) {
  const MIN_INTERVAL_S = 30;
  if (interval < MIN_INTERVAL_S) {
    throw new Error(`Interval minimum is ${MIN_INTERVAL_S} seconds. Got: ${interval}.`);
  }
  const intervalMs = interval * 1000;
  const registry = registryUrl || getRegistry().url;

  const statusPath = syncStatusPath(containerName);
  const BASE_BACKOFF_MS = 60 * 1000;
  const MAX_BACKOFF_MS = 15 * 60 * 1000;

  function nextIntervalMs(consecutiveFailures) {
    if (consecutiveFailures === 0) {
      return intervalMs;
    }
    return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
  }

  let syncCount = 0;
  let consecutiveFailures = 0;
  let lastSync = null;
  let lastSyncSuccess = null;
  const pid = process.pid;

  let shuttingDown = false;
  let syncInProgress = false;
  let timer;

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
    } catch {}
  }

  function scheduleNext() {
    if (shuttingDown) {
      return;
    }
    const delay = nextIntervalMs(consecutiveFailures);
    onProgress?.("sync-scheduled", { nextInSeconds: Math.round(delay / 1000) });
    timer = setTimeout(tick, delay);
  }

  async function tick() {
    if (shuttingDown) {
      return;
    }
    if (syncInProgress) {
      onProgress?.("sync-skipped", { reason: "Previous sync still in progress" });
      scheduleNext();
      return;
    }

    syncInProgress = true;
    const syncStart = new Date().toISOString();
    try {
      await syncOnce(containerName, { registry, onProgress });
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

      onError?.(err, { isAuthError: isAuthError(err) });

      if (!containerExists(containerName)) {
        onError?.(new Error(`Container "${containerName}" no longer exists.`), { fatal: true });
        shuttingDown = true;
        return;
      }
    } finally {
      syncInProgress = false;
    }

    if (!shuttingDown) {
      scheduleNext();
    }
  }

  updateStatus();
  tick();

  return {
    stop() {
      shuttingDown = true;
      if (timer) {
        clearTimeout(timer);
      }
      updateStatus();
    },
  };
}

// --- status ---

export function status(containerName) {
  const { url: registry } = getRegistry();
  const prefix = `machinen/${containerName}`;

  try {
    const diNDHost = getDiNDHost();
    process.env.DOCKER_HOST = diNDHost;
  } catch {}

  const result = {
    containerName,
    registry: `${registry}/${prefix}`,
    local: null,
    remote: null,
    sync: null,
    images: [],
  };

  // Local container status
  try {
    const state = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", containerName],
      {
        stdio: "pipe",
        encoding: "utf-8",
      },
    ).trim();
    result.local = state;
  } catch {
    result.local = "not found";
  }

  // Remote server
  const machines = listMachines();
  const remote = machines.find((m) => m.name === containerName && m.location !== "local");
  if (remote) {
    result.remote = { ip: remote.ip, status: remote.status || "unknown" };
  }

  // Sync daemon info
  let syncStatus = null;
  const root = gitRoot();
  const candidates = [
    root && path.join(root, ".machinen", "sync-status.json"),
    path.join(os.homedir(), ".machinen", containerName, "sync-status.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      syncStatus = JSON.parse(fs.readFileSync(p, "utf-8"));
      break;
    } catch {}
  }

  if (syncStatus) {
    let daemonAlive = false;
    if (syncStatus.pid != null) {
      try {
        process.kill(syncStatus.pid, 0);
        daemonAlive = true;
      } catch {}
    }
    result.sync = {
      running: daemonAlive,
      pid: syncStatus.pid,
      lastSync: syncStatus.lastSync,
      lastSyncSuccess: syncStatus.lastSyncSuccess,
      syncCount: syncStatus.syncCount,
      consecutiveFailures: syncStatus.consecutiveFailures || 0,
    };
  }

  // Registry images (best-effort)
  try {
    const _username = execSync("gh api user --jq .login", {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    const pkgName = encodeURIComponent(prefix);
    const json = execSync(
      `gh api user/packages/container/${pkgName}/versions --jq '[.[:10] | .[] | {tags: .metadata.container.tags, size: .name, updated: .updated_at}]'`,
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();
    result.images = JSON.parse(json || "[]");
  } catch {}

  return result;
}

// --- logs ---

export function logs(containerName) {
  if (!containerName) {
    return discover();
  }

  const machines = listMachines();
  const machine = machines.find((m) => m.name === containerName && m.ip);
  if (!machine) {
    throw new Error(`No remote server for ${containerName}.`);
  }
  ssh(machine.ip, `docker logs -f ${containerName}`);
}
