import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Docker from "dockerode";

export const docker = new Docker({ socketPath: "/var/run/docker.sock" });

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
        `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c "tar cf - -C ${checkpointDir} ." > ${tarPath}`,
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );
    } catch {
      execSync(`tar cf ${tarPath} -C ${checkpointDir} .`, { stdio: "pipe" });
    }

    // Untar locally, patch, retar
    const workDir = path.join(patchDir, "work");
    fs.mkdirSync(workDir);
    execSync(`tar xf ${tarPath} -C ${workDir}`, { stdio: "pipe" });

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
    execSync(`tar cf ${patchedTar} -C ${workDir} .`, { stdio: "pipe" });

    try {
      execSync(
        `cat ${patchedTar} | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m sh -c "tar xf - -C ${checkpointDir}"`,
        { stdio: ["pipe", "pipe", "pipe"], shell: true }
      );
    } catch {
      execSync(`tar xf ${patchedTar} -C ${checkpointDir}`, { stdio: "pipe" });
    }
  } finally {
    fs.rmSync(patchDir, { recursive: true, force: true });
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
      `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c "tar cf - -C ${checkpointPath} ." > ${tarPath}`,
      { stdio: ["pipe", "pipe", "pipe"], shell: true }
    );
  } catch {
    // Fall back to direct filesystem access (native Linux)
    execSync(`tar cf ${tarPath} -C ${checkpointPath} .`, { stdio: "pipe" });
  }

  return { tmpDir, tarPath };
}

export function extractWorkspaceFiles(containerName, containerConfig) {
  const binds = containerConfig.Binds || [];
  const workspaceTars = [];

  for (const bind of binds) {
    // Bind format: "/host/path:/container/path:options"
    const parts = bind.split(":");
    const containerPath = parts[1];
    if (!containerPath) continue;

    const tarName = `workspace-${containerPath.replace(/\//g, "_")}.tar`;
    const tarPath = path.join(os.tmpdir(), tarName);

    try {
      // Copy files out of the container via docker cp
      execSync(`docker cp ${containerName}:${containerPath} - > ${tarPath}`, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });
      workspaceTars.push({ containerPath, tarPath, tarName });
    } catch {
      // Skip mounts that can't be copied (e.g., sockets)
    }
  }

  return workspaceTars;
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
    execSync(`docker build -t ${imageTag} ${buildDir}`, { stdio: "inherit" });
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

export function pushImage(imageTag) {
  console.log(`Pushing ${imageTag}...`);
  execSync(`docker push ${imageTag}`, { stdio: "inherit" });
}

export function pullImage(imageTag) {
  console.log(`Pulling ${imageTag}...`);
  execSync(`docker pull ${imageTag}`, { stdio: "inherit" });
}

export function restoreLocally(imageTag, containerName) {
  // Read labels from the checkpoint image
  const labelsRaw = execSync(
    `docker inspect --format '{{json .Config.Labels}}' ${imageTag}`,
    { stdio: "pipe", encoding: "utf-8" }
  ).trim();
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
  try {
    execSync(`docker rm -f ${containerName}`, { stdio: "pipe" });
  } catch {}

  const createCmd = [
    "docker create",
    `--name ${containerName}`,
    "--security-opt seccomp=unconfined",
    "--network host",
    createImage,
  ].join(" ");

  const newContainerId = execSync(createCmd, { stdio: "pipe", encoding: "utf-8" }).trim();

  // Extract checkpoint from image into Docker's internal checkpoint directory
  try { execSync("docker rm -f machinen-tmp", { stdio: "pipe" }); } catch {}
  execSync(`docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });

  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;

  try {
    // OrbStack: use nsenter to access Docker's internal storage
    execSync(
      `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m sh -c "mkdir -p ${checkpointDir}"`,
      { stdio: "pipe" }
    );
    execSync(`docker cp machinen-tmp:/checkpoint/. - | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m sh -c "tar xf - -C ${checkpointDir}"`, {
      stdio: "pipe",
      shell: true,
    });
  } catch {
    // Native Linux: direct access
    execSync(`mkdir -p ${checkpointDir}`, { stdio: "pipe" });
    execSync(`docker cp machinen-tmp:/checkpoint/. ${checkpointDir}/`, { stdio: "pipe" });
  }

  execSync("docker rm machinen-tmp", { stdio: "pipe" });

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
  execSync(`docker start --checkpoint ${checkpointId} ${containerName}`, { stdio: "inherit" });

  return { newContainerId, checkpointId };
}
