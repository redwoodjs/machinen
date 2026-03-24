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
function patchCheckpointIds(checkpointDir, oldId, newId) {
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
    const workDir = path.join(patchDir, "work");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe" });

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

    // Copy patched files back
    const patchedTar = path.join(patchDir, "patched.tar");
    execFileSync("tar", ["cf", patchedTar, "-C", workDir, "."], { stdio: "pipe" });

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
export function stripBindMountEntries(dir, bindPaths) {
  if (!bindPaths || bindPaths.length === 0) return;

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
      if (bindPaths.some(p => payload.includes(p))) {
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
    execFileSync("tar", ["cf", tarPath, "-C", checkpointPath, "."], { stdio: "pipe" });
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
    const workDir = path.join(tmpDir, "patch");
    fs.mkdirSync(workDir);
    execFileSync("tar", ["xf", tarPath, "-C", workDir], { stdio: "pipe" });
    stripBindMountEntries(workDir, binds);
    execFileSync("tar", ["cf", tarPath, "-C", workDir, "."], { stdio: "pipe" });
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

  // Patch checkpoint: CRIU image files (protobuf binary) contain hardcoded
  // paths with the original container ID (mountpoints, cgroups, etc.).
  // Replace with the new container ID so CRIU can find them.
  // Must be binary-safe (sed mangles protobuf data), so we use Node.js
  // Buffer.replace on the host side.
  if (oldContainerId && oldContainerId !== newContainerId) {
    console.log("Patching checkpoint container ID references...");
    patchCheckpointIds(checkpointDir, oldContainerId, newContainerId);
  }

  // Restore
  dockerExec(["start", "--checkpoint", checkpointId, containerName], { stdio: "inherit" });

  return { newContainerId, checkpointId };
}
