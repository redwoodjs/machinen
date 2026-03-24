import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";

export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

/** Run a docker CLI command without shell interpolation. */
export function dockerExec(args, opts = {}) {
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
        if (err) return reject(err);
        resolve(result);
      }
    );
  });

  return { containerId, checkpointId, config: captureContainerConfig(info) };
}

/**
 * Binary-safe replace of oldId → newId in all .img files under checkpointDir.
 * Copies files out of the Docker VM, patches with Buffer, copies back.
 */
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
      execSync(
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("tar cf - -C " + checkpointDir + " .")} > ${shellQuote(tarPath)}`,
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );
    } catch {
      execFileSync("tar", ["cf", tarPath, "-C", checkpointDir, "."], { stdio: "pipe" });
    }

    // Untar locally, patch, retar
    // COPYFILE_DISABLE=1 prevents macOS tar from creating ._* AppleDouble
    // resource fork files that would corrupt the CRIU checkpoint directory.
    const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
    const workDir = path.join(patchDir, "work");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe", env: tarEnv });

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

    // 2. Strip leftover bind mount entries from mountpoints
    if (bindPathsToStrip.length > 0) {
      stripBindMountEntries(workDir, bindPathsToStrip);
    }

    // Copy patched files back
    const patchedTar = path.join(patchDir, "patched.tar");
    execFileSync("tar", ["cf", patchedTar, "-C", workDir, "."], { stdio: "pipe", env: tarEnv });

    try {
      execSync(
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
 * Strip mount entries from CRIU mountpoints image files that reference
 * the given container paths.  Bind mounts captured during checkpoint
 * can't be restored (the host paths don't exist); the file contents are
 * already baked into the committed image layer, so we just drop them.
 *
 * Uses the same CRIU image format as patch-checkpoint.mjs:
 *   8-byte header + repeated (4-byte LE size + protobuf payload).
 */
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

export function stripBindMountEntries(dir, bindPaths) {
  if (!bindPaths || bindPaths.length === 0) return;

  const paths = expandBindPaths(bindPaths);

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
      const payload = entry.subarray(4).toString("latin1");
      if (paths.some(p => payload.includes(p))) {
        removedCount++;
      } else {
        kept.push(entry);
      }
    }

    if (removedCount > 0) {
      fs.writeFileSync(filePath, Buffer.concat([header, ...kept]));
      console.log(`  stripped ${removedCount} bind mount entries from ${file}`);
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
    // Try nsenter approach first (works on OrbStack and any Docker-in-VM setup).
    // Pipe the tar to stdout and write it on the host to avoid volume mount issues.
    execSync(
      `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("tar cf - -C " + checkpointPath + " .")} > ${shellQuote(tarPath)}`,
      { stdio: ["pipe", "pipe", "pipe"], shell: true }
    );
  } catch {
    // Fall back to direct filesystem access (native Linux)
    execFileSync("tar", ["cf", tarPath, "-C", checkpointPath, "."], { stdio: "pipe", env: { ...process.env, COPYFILE_DISABLE: "1" } });
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
      execSync(`docker cp ${shellQuote(containerName + ":" + containerPath)} - > ${shellQuote(tarPath)}`, {
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
      execSync(`cat ${shellQuote(tarPath)} | docker cp - ${shellQuote(cleanName + ":" + parent)}`, {
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
    const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
    const workDir = path.join(tmpDir, "patch");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe", env: tarEnv });
    stripBindMountEntries(workDir, binds);
    execFileSync("tar", ["cf", tarPath, "-C", workDir, "."], { stdio: "pipe", env: tarEnv });
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

  const newContainerId = dockerExec([
    "create",
    "--name", containerName,
    "--security-opt", "seccomp=unconfined",
    "--network", "host",
    createImage,
  ]).trim();

  // Extract checkpoint from image into Docker's internal checkpoint directory
  try { dockerExec(["rm", "-f", "machinen-tmp"]); } catch {}
  dockerExec(["create", "--name", "machinen-tmp", imageTag]);

  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;

  try {
    // OrbStack: use nsenter to access Docker's internal storage
    dockerExec([
      "run", "--rm", "--privileged", "--pid=host", "alpine",
      "nsenter", "-t", "1", "-m", "sh", "-c", `mkdir -p ${checkpointDir}`,
    ]);
    execSync(`docker cp machinen-tmp:/checkpoint/. - | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("tar xf - -C " + checkpointDir)}`, {
      stdio: "pipe",
      shell: true,
    });
  } catch {
    // Native Linux: direct access
    execFileSync("mkdir", ["-p", checkpointDir], { stdio: "pipe" });
    dockerExec(["cp", "machinen-tmp:/checkpoint/.", `${checkpointDir}/`]);
  }

  dockerExec(["rm", "machinen-tmp"]);

  // Remove macOS AppleDouble resource fork files (._*) that may have been
  // introduced by tar on macOS.  CRIU doesn't expect them and fails to restore.
  try {
    execSync(
      `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("find " + checkpointDir + " -name '._*' -delete")}`,
      { stdio: "pipe", shell: true }
    );
  } catch {
    // Native Linux or no ._* files — ignore
  }

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

  // Also read bind mounts from devcontainer metadata if present
  const dcMeta = labels["devcontainer.metadata"];
  if (dcMeta) {
    try {
      for (const entry of JSON.parse(dcMeta)) {
        for (const m of entry.mounts || []) {
          if (m.type === "bind" && m.target) origBinds.push(m.target);
          // String-format mounts: "source=...,target=...,type=bind"
          if (typeof m === "string" && m.includes("type=bind")) {
            const match = m.match(/target=([^,]+)/);
            if (match) origBinds.push(match[1]);
          }
        }
      }
    } catch {}
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
  const upperDir = JSON.parse(
    dockerExec(["inspect", "--format", "{{json .GraphDriver.Data.UpperDir}}", containerName])
  );
  if (upperDir) {
    // Stale socket paths that need to be hidden for CRIU to bind them.
    const socketPaths = ["/run/docker.sock"];
    try {
      execSync(
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote(
          socketPaths.map(sp =>
            `mkdir -p ${upperDir}$(dirname ${sp}) && rm -f ${upperDir}${sp} && mknod ${upperDir}${sp} c 0 0`
          ).join(" && ")
        )}`,
        { stdio: "pipe", shell: true }
      );
    } catch {
      // Native Linux: direct access
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
    const lines = [`restore timestamp: ${new Date().toISOString()}`];
    lines.push(`checkpoint: ${checkpointId}`);
    lines.push(`container: ${containerName} (${newContainerId})`);
    lines.push(`old container: ${oldContainerId || "n/a"}`);
    lines.push("");

    // List checkpoint files
    try {
      const ls = execSync(
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("ls -la " + checkpointDir + "/")}`,
        { stdio: "pipe", encoding: "utf-8", shell: true }
      );
      lines.push("checkpoint files:", ls);
    } catch {
      try {
        lines.push("checkpoint files:", execFileSync("ls", ["-la", checkpointDir + "/"], { stdio: "pipe", encoding: "utf-8" }));
      } catch (e) { lines.push(`checkpoint files: error: ${e.message}`); }
    }

    // CRIU restore log (written by CRIU on failure, sometimes on success)
    try {
      const log = execSync(
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c ${shellQuote("cat " + checkpointDir + "/restore.log 2>/dev/null || echo '(no restore.log)'")}`,
        { stdio: "pipe", encoding: "utf-8", shell: true }
      );
      lines.push("CRIU restore.log:", log);
    } catch {
      try {
        const log = fs.readFileSync(path.join(checkpointDir, "restore.log"), "utf-8");
        lines.push("CRIU restore.log:", log);
      } catch { lines.push("CRIU restore.log: not found"); }
    }

    return lines.join("\n");
  }

  try {
    dockerExec(["start", "--checkpoint", checkpointId, containerName], { stdio: "inherit" });
    const diag = collectDiagnostics();
    fs.writeFileSync(diagFile, diag);
    console.log(`Diagnostics saved to ${diagFile}`);
  } catch (err) {
    const diag = collectDiagnostics();
    fs.writeFileSync(diagFile, diag + `\n\nERROR: ${err.message}\n`);
    console.error(`\nCRIU restore failed. Diagnostics saved to ${diagFile}`);
    console.error(diag);
    throw err;
  }

  return { newContainerId, checkpointId };
}
