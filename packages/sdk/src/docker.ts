import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";
import { dindExec, DIND_CONTAINER, getDiNDHost, DIND_PORT } from "./dind";

/** Always points to the host Docker socket (OrbStack or native).
 *  Used only to manage the machinen-dind container itself. */
export const hostDocker = new Docker({ socketPath: "/var/run/docker.sock" });

/** Live binding — points to the host docker initially, then reassigned to the
 *  DiND inner daemon by reconnectDocker() after preflight starts machinen-dind.
 *  All importers see the updated value because ESM exports are live bindings. */
export let docker = hostDocker;

/** Reassign the docker live binding to the DiND inner daemon. */
export function reconnectDocker(host, port) {
  docker = new Docker({ host, port, timeout: 30_000 });
}

/** Env for tar that suppresses macOS AppleDouble resource fork files (._*). */
const TAR_ENV = { ...process.env, COPYFILE_DISABLE: "1" };

/** Run a docker CLI command without shell interpolation. */
export function dockerExec(args, opts: Record<string, any> = {}) {
  return execFileSync("docker", args, { stdio: "pipe", encoding: "utf-8", ...opts });
}

/** Escape a value for safe inclusion in a shell string. */
export function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function captureContainerConfig(info) {
  return {
    Image: info.Config.Image,
    Cmd: info.Config.Cmd,
    Env: info.Config.Env,
    User: info.Config.User,
    WorkingDir: info.Config.WorkingDir,
    ExposedPorts: info.Config.ExposedPorts,
    SecurityOpt: info.HostConfig.SecurityOpt,
    NetworkMode: info.HostConfig.NetworkMode,
    Binds: info.HostConfig.Binds,
    CapAdd: info.HostConfig.CapAdd,
    Privileged: info.HostConfig.Privileged,
  };
}

export async function createCheckpoint(containerName, { exit = true } = {}) {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();

  if (!info.State.Running) {
    throw new Error(`Container ${containerName} is not running (status: ${info.State.Status})`);
  }

  // Detach all tmux clients before checkpointing.  A tmux client started via
  // `docker exec` lives in the same network namespace as the tmux server but
  // is NOT a descendant of PID 1.  The resulting half-connected Unix socket
  // stream makes CRIU abort with "Can't dump half of stream unix connection".
  //
  // Must run as the tmux session owner: devcontainers use remoteUser (e.g.
  // "node") whose socket is /tmp/tmux-1000/default, not root's
  // /tmp/tmux-0/default.  Without --user the commands silently hit the wrong
  // socket and the connections are never cleaned up.
  //
  // `tmux detach-client -a` sends the detach signal but returns before the
  // client process has exited and closed its socket (race condition).  We also
  // kill client PIDs directly and poll until no established tmux socket
  // connections remain.
  const tmuxUser = resolveContainerUser(containerName);
  const userArgs = tmuxUser ? ["--user", tmuxUser] : [];
  try { dockerExec(["exec", ...userArgs, containerName, "tmux", "detach-client", "-a"]); } catch {}
  try {
    dockerExec(["exec", ...userArgs, containerName, "sh", "-c",
      "tmux list-clients -F '#{client_pid}' 2>/dev/null | xargs -r kill -TERM 2>/dev/null || true"]);
  } catch {}
  // Poll until all tmux clients have disconnected (max 5 seconds).
  // Use `tmux list-clients` rather than `ss` — more portable across distros.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const out = dockerExec(["exec", ...userArgs, containerName, "sh", "-c",
        "tmux list-clients 2>/dev/null | wc -l"]).trim();
      if (out === "0") break;
    } catch { break; }
  }

  const containerId = info.Id;
  const checkpointId = `checkpoint-${Date.now()}`;

  await new Promise((resolve, reject) => {
    docker.modem.dial(
      {
        method: "POST",
        path: `/containers/${containerId}/checkpoints`,
        options: {
          CheckpointID: checkpointId,
          Exit: exit,
        },
        statusCodes: { 200: true, 201: true },
      },
      (err, result) => {
        if (err) {
          // Collect the CRIU dump log for diagnostics.
          const dumpLogPath = `/var/run/docker/containerd/daemon/io.containerd.runtime.v2.task/moby/${containerId}/criu-dump.log`;
          try {
            const log = dindExec(`cat ${dumpLogPath} 2>/dev/null || echo '(no dump log)'`, { encoding: "utf-8" });
            const errors = log.split("\n").filter(l => /error|Error|errno|failed/i.test(l)).join("\n");
            if (errors) console.error("CRIU dump errors:\n" + errors);
            else console.error("CRIU dump log (tail):\n" + log.split("\n").slice(-20).join("\n"));
          } catch {}
          return reject(err);
        }
        resolve(result);
      }
    );
  });

  return { containerId, checkpointId, config: captureContainerConfig(info) };
}

/**
 * Patch a checkpoint directory: replace container IDs and optionally strip
 * leftover bind mount entries.  Both operations happen in a single pass to
 * avoid extra tar round-trips through the Docker VM.
 */
function patchCheckpoint(checkpointDir, oldId, newId, bindPathsToStrip = []) {
  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-patch-"));
  const tarPath = path.join(patchDir, "checkpoint-patch.tar");

  try {
    // Extract .img files from the checkpoint dir
    try {
      (execSync as any)(
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("tar cf - -C " + checkpointDir + " .")} > ${shellQuote(tarPath)}`,
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );
    } catch {
      execFileSync("tar", ["cf", tarPath, "-C", checkpointDir, "."], { stdio: "pipe" });
    }

    const workDir = path.join(patchDir, "work");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe", env: TAR_ENV });

    // 1. Replace container IDs in all .img files (binary-safe)
    const oldBuf = Buffer.from(oldId, "utf-8");
    const newBuf = Buffer.from(newId, "utf-8");

    for (const file of fs.readdirSync(workDir)) {
      if (!file.endsWith(".img")) continue;
      const filePath = path.join(workDir, file);
      const data = fs.readFileSync(filePath);
      let offset = 0;
      let patched = false;
      while ((offset = data.indexOf(oldBuf, offset)) !== -1) {
        newBuf.copy(data, offset);
        offset += newBuf.length;
        patched = true;
      }
      if (patched) {
        fs.writeFileSync(filePath, data);
        console.log(`  patched: ${file}`);
      }
    }

    // 2. Strip bind mount entries and Docker masking mounts from mountpoints.
    // Any mount whose path is under /proc/ or /sys/ is a Docker-managed masking
    // mount (tmpfs/readonly bind) that references a parent mount ID (/proc, /sys)
    // which differs in the restore container.  CRIU can't remap these and aborts
    // with "No mapping for X:(null) mountpoint".  Docker recreates them on start.
    stripBindMountEntries(workDir, bindPathsToStrip);

    // Copy patched files back
    const patchedTar = path.join(patchDir, "patched.tar");
    execFileSync("tar", ["cf", patchedTar, "-C", workDir, "."], { stdio: "pipe", env: TAR_ENV });

    try {
      (execSync as any)(
        `cat ${shellQuote(patchedTar)} | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("tar xf - -C " + checkpointDir)}`,
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );
    } catch {
      execFileSync("tar", ["xf", patchedTar, "-C", checkpointDir], { stdio: "pipe" });
    }
  } finally {
    fs.rmSync(patchDir, { recursive: true, force: true });
  }
}

/**
 * Expand bind paths to include common symlink variants.
 * CRIU resolves symlinks (e.g. /var/run → /run) before recording mount paths,
 * but Docker may report the unresolved path.  Generate both forms so we match
 * regardless of which one appears in the checkpoint.
 */
function expandBindPaths(bindPaths) {
  const expanded = new Set(bindPaths);
  for (const p of bindPaths) {
    if (p.startsWith("/var/run/")) expanded.add("/run/" + p.slice("/var/run/".length));
    else if (p.startsWith("/run/")) expanded.add("/var/run/" + p.slice("/run/".length));
  }
  return [...expanded];
}

/**
 * Extract the mountpoint string from a raw CRIU MntEntry protobuf buffer.
 * MntEntry.mountpoint is field 4 (wire type 2 = length-delimited string).
 * Returns null if not found or parse error.
 */
function getMountpointFromEntry(buf) {
  let offset = 0;
  while (offset < buf.length) {
    // Read tag varint
    let tag = 0, shift = 0, byte;
    do {
      if (offset >= buf.length) return null;
      byte = buf[offset++];
      tag |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === 0) { // varint — skip
      do {
        if (offset >= buf.length) return null;
      } while (buf[offset++] & 0x80);
    } else if (wireType === 2) { // length-delimited
      let len = 0, shift2 = 0;
      do {
        if (offset >= buf.length) return null;
        byte = buf[offset++];
        len |= (byte & 0x7f) << shift2;
        shift2 += 7;
      } while (byte & 0x80);
      if (fieldNumber === 7) { // mountpoint (field 7 in CRIU MntEntry proto)
        return buf.subarray(offset, offset + len).toString("utf-8");
      }
      offset += len;
    } else if (wireType === 5) { // 32-bit fixed
      offset += 4;
    } else if (wireType === 1) { // 64-bit fixed
      offset += 8;
    } else {
      return null; // unknown wire type
    }
  }
  return null;
}

/**
 * Decode all MntEntry records from a mountpoints-*.img binary buffer.
 *
 * The CRIU MntEntry proto field layout differs between versions.  Modern CRIU
 * (v3+) has mountpoint at field 5; older versions had it at field 7.  We
 * extract multiple fields so the caller can pick the right interpretation.
 *
 * Returns objects with:
 *   f1..f4: first four uint32 varint fields (mnt_id, parent_id, root_dev, root_ino in v3+)
 *   s5, s6, s7, s8: first four length-delimited string fields
 */
function decodeMntFile(data) {
  if (data.length < 8) return [];
  let offset = 8; // skip 8-byte header
  const entries = [];
  while (offset + 4 <= data.length) {
    const size = data.readUInt32LE(offset);
    if (size === 0 || offset + 4 + size > data.length) break;
    const buf = data.subarray(offset + 4, offset + 4 + size);
    offset += 4 + size;
    let pos = 0;
    const uint32s = {};  // fieldNum → value
    const strings = {};  // fieldNum → value
    while (pos < buf.length) {
      let tag = 0, shift = 0, byte;
      do {
        if (pos >= buf.length) break;
        byte = buf[pos++];
        tag |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      const fieldNum = tag >> 3, wireType = tag & 7;
      if (wireType === 0) {
        let val = 0, s = 0;
        do { if (pos >= buf.length) break; byte = buf[pos++]; val |= (byte & 0x7f) << s; s += 7; } while (byte & 0x80);
        uint32s[fieldNum] = val;
      } else if (wireType === 2) {
        let len = 0, s = 0;
        do { if (pos >= buf.length) break; byte = buf[pos++]; len |= (byte & 0x7f) << s; s += 7; } while (byte & 0x80);
        strings[fieldNum] = buf.subarray(pos, pos + len).toString("utf-8");
        pos += len;
      } else if (wireType === 5) pos += 4;
      else if (wireType === 1) pos += 8;
      else break;
    }
    entries.push({
      f1: uint32s[1] ?? 0, f2: uint32s[2] ?? 0,
      f3: uint32s[3] ?? 0, f4: uint32s[4] ?? 0,
      s5: strings[5] ?? "", s6: strings[6] ?? "",
      s7: strings[7] ?? "", s8: strings[8] ?? "",
    });
  }
  return entries;
}

export function stripBindMountEntries(dir, bindPaths?) {
  const paths = bindPaths ? expandBindPaths(bindPaths) : [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith("mountpoints-") || !file.endsWith(".img")) continue;

    const filePath = path.join(dir, file);
    const data = fs.readFileSync(filePath);
    if (data.length < 8) continue;

    const header = data.subarray(0, 8);
    let offset = 8;
    const entries = [];
    while (offset + 4 <= data.length) {
      const size = data.readUInt32LE(offset);
      if (size === 0 || offset + 4 + size > data.length) break;
      entries.push(data.subarray(offset, offset + 4 + size));
      offset += 4 + size;
    }

    let removedCount = 0;
    const kept = [];
    for (const entry of entries) {
      const payload = entry.subarray(4);

      // Strip bind mount paths specified by caller (string search in binary payload)
      if (paths.length > 0) {
        const payloadStr = payload.toString("latin1");
        if (paths.some(p => payloadStr.includes(p))) {
          removedCount++;
          continue;
        }
      }

      // Strip Docker-managed mounts whose parent mount IDs are kernel-assigned
      // and differ between containers.  CRIU aborts with "No mapping for X:(null)
      // mountpoint".  Docker recreates all of these on every container start.
      //
      // - /proc/* and /sys/* — masking tmpfs/bind mounts under proc/sysfs
      // - /etc/hosts, /etc/hostname, /etc/resolv.conf — Docker bind mounts
      //   that reference parent IDs not present in the restore container
      //
      // NOTE: do NOT strip /dev/* — CRIU needs /dev/pts to restore PTY file
      // descriptors (e.g. tmux sessions).  The /dev submounts are external
      // mounts handled by runc's --ext-mount-map on both Linux and OrbStack.
      const mp = getMountpointFromEntry(payload);
      if (
        mp &&
        (mp.startsWith("/proc/") ||
          mp.startsWith("/sys/") ||
          mp === "/etc/hosts" ||
          mp === "/etc/hostname" ||
          mp === "/etc/resolv.conf")
      ) {
        removedCount++;
        continue;
      }

      kept.push(entry);
    }

    if (removedCount > 0) {
      fs.writeFileSync(filePath, Buffer.concat([header, ...kept]));
      console.log(`  stripped ${removedCount} mount entries from ${file}`);
    }
  }
}

export function extractCheckpointFiles(containerId, checkpointId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-"));
  const tarPath = path.join(tmpDir, "checkpoint.tar");

  // Extract checkpoint files from Docker's internal storage.
  // On OrbStack (macOS), these are inside the Docker VM — use nsenter.
  // On Linux, they're directly accessible.
  const checkpointPath = `/var/lib/docker/containers/${containerId}/checkpoints/${checkpointId}`;

  try {
    // Execute tar inside the DiND container which has direct access to the
    // inner daemon's /var/lib/docker.  Use the HOST Docker socket so this
    // works even when DOCKER_HOST is pointing at the DiND inner daemon.
    (execSync as any)(
      `docker exec ${DIND_CONTAINER} sh -c ${shellQuote("tar cf - -C " + checkpointPath + " .")} > ${shellQuote(tarPath)}`,
      { stdio: ["pipe", "pipe", "pipe"], shell: true,
        env: { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" } }
    );
  } catch {
    // Fall back to direct filesystem access (native Linux without DiND)
    execFileSync("tar", ["cf", tarPath, "-C", checkpointPath, "."], { stdio: "pipe", env: TAR_ENV });
  }

  return { tmpDir, tarPath };
}

export function buildCheckpointImage(tarPath, originalImage, containerConfig, checkpointId, imageTag, workspaceTars = [], baseImageTag = "", checkpointedContainerId = "") {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-build-"));

  try {
    // Copy the checkpoint tar into the build context
    fs.copyFileSync(tarPath, path.join(buildDir, "checkpoint.tar"));

    // Copy workspace tars into build context
    const workspaceAdds = [];
    for (const { tarPath: wTar, tarName } of workspaceTars) {
      fs.copyFileSync(wTar, path.join(buildDir, tarName));
      workspaceAdds.push(`ADD ${tarName} /workspace-data/`);
    }

    // Write Dockerfile
    const configJson = JSON.stringify(containerConfig).replace(/'/g, "'\\''");
    const dockerfile = `FROM ${originalImage}
LABEL machinen.config='${configJson}'
LABEL machinen.checkpoint-id='${checkpointId}'
LABEL machinen.original-image='${originalImage}'
LABEL machinen.base-image='${baseImageTag}'
LABEL machinen.container-id='${checkpointedContainerId}'
ADD checkpoint.tar /checkpoint/
${workspaceAdds.join("\n")}
`;
    fs.writeFileSync(path.join(buildDir, "Dockerfile"), dockerfile);

    // Build
    console.log(`Building image ${imageTag}...`);
    dockerExec(["build", "-t", imageTag, buildDir], { stdio: "inherit" });
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

/**
 * Commit a running container's filesystem, bake bind mounts into the image,
 * and checkpoint the original container to preserve its process tree.
 * Optionally stops the container after checkpoint (freeze) or leaves it
 * running (background sync).
 *
 * Returns { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath }
 * Caller is responsible for cleanup (tmpDir, commitImage).
 */
export async function prepareCheckpoint(containerName, { stop = false } = {}) {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const config = captureContainerConfig(info);
  const commitImage = `${containerName}-committed`;

  // Extract bind-mounted files while the container is still running.
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
      (execSync as any)(`docker cp ${shellQuote(containerName + ":" + containerPath)} - > ${shellQuote(tarPath)}`, {
        stdio: ["pipe", "pipe", "pipe"], shell: true,
      });
      savedBinds.push({ containerPath, tarPath });
      console.log(`Saved bind mount: ${containerPath}`);
    } catch {
      // Skip mounts that can't be copied (sockets, etc.)
    }
  }

  // Commit the running container to capture filesystem state
  console.log("Committing container filesystem...");
  dockerExec(["commit", containerName, commitImage]);

  // Bake bind-mounted files into the committed image so they survive restore.
  // Use a temporary container for this — it is NOT checkpointed.
  const cleanName = `${containerName}-clean`;
  if (savedBinds.length > 0) {
    try { dockerExec(["rm", "-f", cleanName]); } catch {}
    dockerExec([
      "run", "-d",
      "--name", cleanName,
      "--entrypoint", "sleep",
      commitImage,
      "infinity",
    ]);
    for (const { containerPath, tarPath } of savedBinds) {
      const parent = path.posix.dirname(containerPath);
      (execSync as any)(`cat ${shellQuote(tarPath)} | docker cp - ${shellQuote(cleanName + ":" + parent)}`, {
        stdio: ["pipe", "pipe", "pipe"], shell: true,
      });
      console.log(`Restored bind mount into image: ${containerPath}`);
    }
    console.log("Re-committing with workspace files...");
    dockerExec(["commit", cleanName, commitImage]);
    dockerExec(["rm", "-f", cleanName]);
  }
  if (workspaceTmpDir) fs.rmSync(workspaceTmpDir, { recursive: true, force: true });

  // Checkpoint the original container directly to preserve the real process tree.
  // exit=true stops the container after checkpoint (freeze); exit=false keeps it
  // running (background sync).
  const { containerId, checkpointId } = await createCheckpoint(containerName, { exit: stop });
  console.log(`Checkpoint: ${checkpointId}`);

  console.log("Extracting checkpoint files...");
  const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

  // Strip bind-mount entries from CRIU checkpoint — the file contents are
  // already baked into the committed image, and the host paths won't exist
  // on restore.
  if (binds.length > 0) {
    const workDir = path.join(tmpDir, "patch");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe", env: TAR_ENV });
    stripBindMountEntries(workDir, binds);
    execFileSync("tar", ["cf", tarPath, "-C", workDir, "."], { stdio: "pipe", env: TAR_ENV });
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  return { config, commitImage, cleanName, containerId, checkpointId, tmpDir, tarPath };
}

export function pushImage(imageTag) {
  console.log(`Pushing ${imageTag}...`);
  dockerExec(["push", imageTag], { stdio: "inherit" });
}

export function pullImage(imageTag) {
  console.log(`Pulling ${imageTag}...`);
  dockerExec(["pull", imageTag], { stdio: "inherit" });
}

// --- tmux session helpers ---
//
// Uses tmux to run user shells as children of PID 1.  The tmux server is
// started inside the container's PID namespace, making it and all shells it
// hosts descendants of PID 1.  CRIU captures the full tree on checkpoint and
// restores it on the remote machine — including in-memory state.
//
// Requires a patched CRIU that removes the tty_verify_ctty pid_real check
// (scripts/patch-criu.py).  Unpatched CRIU rejects tmux with
// "ctty inheritance detected".

const TMUX_SESSION = "machinen";

/**
 * Resolve the effective user for docker exec inside a container.
 * Devcontainers set remoteUser in the devcontainer.metadata label rather than
 * Docker's Config.User, so we check labels first.
 */
export function resolveContainerUser(containerName) {
  const labelsRaw = dockerExec(["inspect", "--format", "{{json .Config.Labels}}", containerName]).trim();
  const labels = JSON.parse(labelsRaw || "{}");
  let user = "";
  const dcMetaRaw = labels["devcontainer.metadata"];
  if (dcMetaRaw) {
    try {
      const entries = JSON.parse(dcMetaRaw);
      for (const entry of entries) {
        if (entry.remoteUser) user = entry.remoteUser;
      }
    } catch {}
  }
  if (!user) {
    user = dockerExec(["inspect", "--format", "{{.Config.User}}", containerName]).trim();
  }
  return user || undefined;
}

/** Check whether the machinen tmux session is running inside the container. */
export function hasTmuxSession(containerName, sessionName = TMUX_SESSION, { user }: any = {}) {
  try {
    const args = ["exec"];
    if (user) args.push("--user", user);
    args.push(containerName, "tmux", "has-session", "-t", sessionName);
    dockerExec(args);
    return true;
  } catch {
    return false;
  }
}

/** Start a tmux session inside the container if not already running. */
export function ensureTmuxSession(containerName, { user, sessionName = TMUX_SESSION }: any = {}) {
  const workdir = dockerExec(
    ["inspect", "--format", "{{.Config.WorkingDir}}", containerName]
  ).trim() || "/";

  // Install tmux as root — apt-get/apk require root even if the session user is non-root.
  // Run apt-get update first (Debian/Ubuntu images need a fresh package index).
  // Suppress all output; the session-start command below will surface any real failure.
  dockerExec(["exec", "--user", "root", containerName, "sh", "-c",
    "command -v tmux >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq tmux >/dev/null 2>&1; } || apk add -q tmux >/dev/null 2>&1 || true"]);

  // Start the session as the specified user so the tmux socket is owned by that user.
  const sessionArgs = ["exec"];
  if (user) sessionArgs.push("--user", user);
  sessionArgs.push(containerName, "sh", "-c",
    `tmux has-session -t ${sessionName} 2>/dev/null || tmux new-session -d -c ${shellQuote(workdir)} -s ${sessionName}`);
  dockerExec(sessionArgs);
}

/** Return docker CLI args to attach to the tmux session. */
export function tmuxAttachArgs(containerName, { user, sessionName = TMUX_SESSION }: any = {}) {
  const args = ["exec", "-it"];
  if (user) args.push("--user", user);
  args.push(containerName, "tmux", "attach-session", "-t", sessionName);
  return args;
}

export function restoreLocally(imageTag, containerName) {
  // Read labels from the checkpoint image
  const labelsRaw = dockerExec(["inspect", "--format", "{{json .Config.Labels}}", imageTag]).trim();
  const labels = JSON.parse(labelsRaw);

  const config = JSON.parse(labels["machinen.config"]);
  const checkpointId = labels["machinen.checkpoint-id"];
  const baseImageTag = labels["machinen.base-image"];
  const oldContainerId = labels["machinen.container-id"];

  // The restore container must use the same image layers as the checkpointed
  // container.  The checkpoint was taken against the committed (base) image,
  // so we pull and create from that.  Fall back to imageTag for old images
  // that don't carry the base-image label.
  const createImage = baseImageTag || imageTag;
  if (baseImageTag) {
    pullImage(baseImageTag);
  }

  // Remove existing container
  try { dockerExec(["rm", "-f", containerName]); } catch {}

  // Parse devcontainer metadata once — used for user resolution and bind mount discovery.
  let dcMetaEntries = [];
  const dcMetaRaw = labels["devcontainer.metadata"];
  if (dcMetaRaw) {
    try { dcMetaEntries = JSON.parse(dcMetaRaw); } catch {}
  }

  // Resolve the container user.  The checkpoint image config stores the
  // Docker-level User; devcontainer metadata may override via remoteUser.
  let user = config.User || "";
  for (const entry of dcMetaEntries) {
    if (entry.remoteUser) user = entry.remoteUser;
  }

  const createArgs = [
    "create",
    "--name", containerName,
    "--security-opt", "seccomp=unconfined",
    "--network", "host",
  ];
  if (user) createArgs.push("--user", user);
  createArgs.push(createImage);
  const newContainerId = dockerExec(createArgs).trim();

  // Extract checkpoint from image into Docker's internal checkpoint directory
  try { dockerExec(["rm", "-f", "machinen-tmp"]); } catch {}
  dockerExec(["create", "--name", "machinen-tmp", imageTag]);

  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;

  try {
    // Write checkpoint files into the inner daemon's /var/lib/docker via the
    // DiND container.  docker cp (left side) uses the DiND inner daemon
    // (DOCKER_HOST is already set); docker exec (right side) uses the HOST
    // socket to write into the DiND container's filesystem.
    dindExec(`mkdir -p ${checkpointDir}`);
    (execSync as any)(
      `docker cp machinen-tmp:/checkpoint/. - | ` +
      `DOCKER_HOST=unix:///var/run/docker.sock docker exec -i ${DIND_CONTAINER} sh -c ` +
      shellQuote(`tar xf - -C ${checkpointDir} && find ${checkpointDir} -name '._*' -delete`),
      { stdio: "pipe", shell: true },
    );
  } catch {
    // Native Linux without DiND: direct filesystem access
    execFileSync("mkdir", ["-p", checkpointDir], { stdio: "pipe" });
    dockerExec(["cp", "machinen-tmp:/checkpoint/.", `${checkpointDir}/`]);
  }

  dockerExec(["rm", "machinen-tmp"]);

  // Patch checkpoint: replace hardcoded container IDs and strip any leftover
  // bind mount entries.  The restore container has no bind mounts, so any
  // bind mount still in the checkpoint would cause CRIU to fail with
  // "No mapping for <mnt_id> mountpoint".
  //
  // Bind paths come from the original container's config.  They may have been
  // stripped during freeze, but we re-strip here as a safety net (path
  // normalization fixes, older checkpoints, etc.).
  const origBinds = [...new Set([
    ...(config.Binds || []).map(b => b.split(":")[1]),
  ].filter(Boolean))];

  // Also read bind mounts from devcontainer metadata
  for (const entry of dcMetaEntries) {
    if (!Array.isArray(entry.mounts)) continue;
    for (const m of entry.mounts) {
      if (typeof m === "string") {
        if (m.includes("type=bind")) {
          const match = m.match(/target=([^,]+)/);
          if (match) origBinds.push(match[1]);
        }
      } else if (m.type === "bind" && m.target) {
        origBinds.push(m.target);
      }
    }
  }

  const needsPatch = oldContainerId && oldContainerId !== newContainerId;
  if (needsPatch || origBinds.length > 0) {
    console.log("Patching checkpoint...");
    patchCheckpoint(
      checkpointDir,
      oldContainerId || "",
      newContainerId,
      origBinds,
    );
  }

  // Remove stale socket files from the container's overlay.  The committed
  // image may contain socket files (e.g. /run/docker.sock from socat) that
  // CRIU needs to re-bind during restore.  If the file already exists CRIU
  // fails with "Address already in use".
  //
  // Since the socket may live in a lower (read-only) layer, we create an
  // overlayfs whiteout (char device 0:0) in the upper layer to hide it.
  //
  // In DiND with containerd snapshotting, GraphDriver.Data.UpperDir is not
  // available from docker inspect.  Attempt a fallback via /proc/mounts
  // (only populated for running containers), otherwise skip the whiteout.
  let upperDir = null;
  try {
    upperDir = JSON.parse(
      dockerExec(["inspect", "--format", "{{json .GraphDriver.Data.UpperDir}}", containerName])
    );
  } catch {}
  if (!upperDir) {
    // Containerd snapshotting mode: find UpperDir from DiND /proc/mounts.
    // The container is in 'created' state here, so the overlay is not yet
    // mounted — the whiteout step is skipped.  Restore will fail with
    // "Address already in use" only if the committed image contains socket
    // files; that is rare when no docker-outside-of-docker features are used.
    try {
      const mounts = dindExec(`cat /proc/mounts`);
      const line = mounts.split("\n").find(l => l.includes(`overlayfs/${newContainerId}`));
      if (line) {
        const m = line.match(/upperdir=([^,\s]+)/);
        if (m) upperDir = m[1];
      }
    } catch {}
  }
  if (upperDir) {
    // Stale socket paths that need to be hidden for CRIU to bind them.
    const socketPaths = ["/run/docker.sock", "/run/test.sock"];
    const whiteoutCmds = socketPaths.map(sp =>
      `mkdir -p ${upperDir}$(dirname ${sp}) && rm -f ${upperDir}${sp} && mknod ${upperDir}${sp} c 0 0`
    ).join(" && ");
    try {
      dindExec(whiteoutCmds);
    } catch {
      // Native Linux without DiND: direct filesystem access
      for (const sp of socketPaths) {
        try {
          const dir = path.dirname(upperDir + sp);
          execFileSync("mkdir", ["-p", dir], { stdio: "pipe" });
          try { fs.unlinkSync(upperDir + sp); } catch {}
          execFileSync("mknod", [upperDir + sp, "c", "0", "0"], { stdio: "pipe" });
        } catch {}
      }
    }
  }

  // Restore — always capture CRIU diagnostics to a log file
  const diagDir = path.join(os.homedir(), ".machinen", "logs");
  fs.mkdirSync(diagDir, { recursive: true });
  const diagFile = path.join(diagDir, `restore-${Date.now()}.log`);

  function collectDiagnostics() {
    const lines = [
      `restore timestamp: ${new Date().toISOString()}`,
      `checkpoint: ${checkpointId}`,
      `container: ${containerName} (${newContainerId})`,
      `old container: ${oldContainerId || "n/a"}`,
      "",
    ];

    // 1. Checkpoint file listing + restore.log from checkpoint dir
    // Note: CRIU writes restore.log to its --work-dir (containerd task bundle), NOT the
    // checkpoint dir.  Docker cleans up the task bundle on failure, so we often won't
    // find it there.  We still check as a fallback.
    try {
      const out = dindExec(
        `ls -la ${checkpointDir}/ 2>&1; echo '---CRIU_LOG---'; cat ${checkpointDir}/restore.log 2>/dev/null || echo '(no restore.log in checkpoint dir)'`,
        { encoding: "utf-8" },
      );
      const [fileList, criuLog] = out.split("---CRIU_LOG---");
      lines.push("checkpoint files:", fileList.trim(), "", "CRIU restore.log (checkpoint dir):", criuLog.trim());
    } catch {
      try {
        lines.push("checkpoint files:", execFileSync("ls", ["-la", checkpointDir + "/"], { stdio: "pipe", encoding: "utf-8" }));
        try {
          const log = fs.readFileSync(path.join(checkpointDir, "restore.log"), "utf-8");
          lines.push("CRIU restore.log:", log);
        } catch { lines.push("CRIU restore.log: (not found)"); }
      } catch (e) { lines.push(`diagnostics error: ${e.message}`); }
    }

    // 2. CRIU restore.log from containerd task bundle (cleaned up on failure, but try)
    try {
      const taskDirs = [
        `/run/containerd/io.containerd.runtime.v2.task/moby/${newContainerId}`,
        `/var/run/docker/containerd/daemon/io.containerd.runtime.v2.task/moby/${newContainerId}`,
      ];
      const searchCmd = taskDirs.map(d => `cat ${d}/restore.log 2>/dev/null`).join("; ");
      const taskLog = dindExec(searchCmd, { encoding: "utf-8" }).trim();
      if (taskLog) lines.push("", "CRIU restore.log (containerd task dir):", taskLog);
    } catch {}

    // 3. Docker daemon journal — persists even after container is removed.
    // Try multiple log sources since OrbStack may not use journald.
    try {
      const logCmd = [
        `journalctl -u docker --no-pager --since "3 minutes ago" 2>/dev/null | grep -i 'criu\\|mnt:\\|restore\\|errno' | tail -40`,
        `cat /var/log/docker.log 2>/dev/null | tail -100 | grep -i 'criu\\|mnt:\\|restore\\|errno'`,
        `cat /var/log/daemon.log 2>/dev/null | tail -100 | grep -i criu`,
      ].join("; ");
      const daemonLog = dindExec(logCmd, { encoding: "utf-8" }).trim();
      if (daemonLog) lines.push("", "Docker daemon log (CRIU-related):", daemonLog);
      else lines.push("", "Docker daemon log: (no CRIU output found in journald/daemon logs)");
    } catch {}

    // 4. Decode remaining mount entries from checkpoint.
    // Show ALL fields to identify the correct proto field mapping:
    //   Modern CRIU (v3+):  f1=mnt_id  f2=parent_id  f3=root_dev  f4=root_ino  s5=mountpoint  s7=source
    //   Older CRIU:         f1=mnt_id  f2=parent_id  ...           s7=mountpoint
    // Also run `criu decode` if available for authoritative output.
    try {
      const b64Out = dindExec(
        `for f in ${checkpointDir}/mountpoints-*.img; do [ -f "$f" ] && echo "====$(basename $f)"; base64 "$f"; done 2>/dev/null`,
        { encoding: "utf-8" },
      );
      const blocks = b64Out.split(/^====(.+)$/m).slice(1);
      for (let i = 0; i < blocks.length; i += 2) {
        const fname = blocks[i].trim();
        const data = Buffer.from(blocks[i + 1].replace(/\s/g, ""), "base64");
        const entries = decodeMntFile(data);
        if (entries.length === 0) continue;
        // Build set of all uint32 values that appear as f1 (mnt_id candidate)
        const f1Set = new Set(entries.map(e => e.f1));
        const f3Set = new Set(entries.map(e => e.f3));
        lines.push("", `mount entries in ${fname} (raw fields):`);
        for (const e of entries) {
          const extF2 = f1Set.has(e.f2) ? "" : " [f2-ext]";
          const extF4 = f3Set.has(e.f4) ? "" : " [f4-ext]";
          lines.push(
            `  f1=${e.f1} f2=${e.f2}${extF2} f3=${e.f3} f4=${e.f4}${extF4}` +
            `  s5=${JSON.stringify(e.s5)} s7=${JSON.stringify(e.s7)}`,
          );
        }
      }
    } catch {}

    // 5. criu decode — authoritative human-readable dump if criu binary is available
    try {
      const criuDecodeOut = dindExec(
        `criu --version 2>/dev/null | head -1; ` +
        `for f in ${checkpointDir}/mountpoints-*.img; do ` +
        `echo "=== criu decode $f ==="; ` +
        `criu decode --images-dir ${checkpointDir} -F "$(basename $f)" 2>/dev/null || echo "(decode failed)"; ` +
        `done`,
        { encoding: "utf-8" },
      ).trim();
      if (criuDecodeOut) lines.push("", "criu decode output:", criuDecodeOut);
    } catch {}

    return lines.join("\n");
  }

  try {
    dockerExec(["start", "--checkpoint", checkpointId, containerName], { stdio: "inherit" });
    const diag = collectDiagnostics();
    fs.writeFileSync(diagFile, diag);
    console.log(`Diagnostics saved to ${diagFile}`);
  } catch (err: any) {
    const diag = collectDiagnostics();
    fs.writeFileSync(diagFile, diag + `\n\nERROR: ${err.message}\n`);
    console.error(`\nCRIU restore failed. Diagnostics saved to ${diagFile}`);
    console.error(diag);
    throw err;
  }

  // Fix /etc/resolv.conf: stripped from mountpoints.img to allow CRIU restore.
  // Restore DNS by copying the DiND container's resolv.conf into the devcontainer.
  try {
    const resolvConf = dindExec("cat /etc/resolv.conf", { encoding: "utf-8" });
    dockerExec(["exec", "--user", "root", containerName, "sh", "-c",
      `printf '%s' ${shellQuote(resolvConf)} > /etc/resolv.conf`]);
    console.log("Restored /etc/resolv.conf");
  } catch {
    console.warn("Warning: could not restore /etc/resolv.conf (DNS may not work)");
  }

  // Ensure a tmux session is running in the restored container.
  // CRIU will have restored it if it was running at checkpoint time; this
  // also handles the case where the container was frozen without one.
  try {
    const containerUser = resolveContainerUser(containerName);
    ensureTmuxSession(containerName, { user: containerUser });
    console.log("tmux session ready");
  } catch (err: any) {
    console.warn(`Warning: could not ensure tmux session: ${err.message}`);
  }

  return { newContainerId, checkpointId };
}
