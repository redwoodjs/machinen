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

export function extractCheckpointFiles(containerId, checkpointId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-"));
  const tarPath = path.join(tmpDir, "checkpoint.tar");

  // Extract checkpoint files from Docker's internal storage.
  // On OrbStack (macOS), these are inside the Docker VM — use nsenter.
  // On Linux, they're directly accessible.
  const checkpointPath = `/var/lib/docker/containers/${containerId}/checkpoints/${checkpointId}`;

  try {
    // Try nsenter approach first (works on OrbStack and any Docker-in-VM setup)
    execSync(
      `docker run --rm --privileged --pid=host -v ${tmpDir}:/out alpine nsenter -t 1 -m sh -c "tar cf /out/checkpoint.tar -C ${checkpointPath} ."`,
      { stdio: "pipe" }
    );
  } catch {
    // Fall back to direct filesystem access (native Linux)
    execSync(`tar cf ${tarPath} -C ${checkpointPath} .`, { stdio: "pipe" });
  }

  return { tmpDir, tarPath };
}

export function buildCheckpointImage(tarPath, originalImage, containerConfig, checkpointId, imageTag) {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-build-"));

  try {
    // Copy the checkpoint tar into the build context
    fs.copyFileSync(tarPath, path.join(buildDir, "checkpoint.tar"));

    // Write Dockerfile
    const configJson = JSON.stringify(containerConfig).replace(/'/g, "'\\''");
    const dockerfile = `FROM ${originalImage}
LABEL machinen.config='${configJson}'
LABEL machinen.checkpoint-id='${checkpointId}'
LABEL machinen.original-image='${originalImage}'
ADD checkpoint.tar /checkpoint/
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
  const originalImage = labels["machinen.original-image"];

  // Remove existing container
  try {
    execSync(`docker rm -f ${containerName}`, { stdio: "pipe" });
  } catch {}

  // Recreate container with original config
  const envFlags = (config.Env || [])
    .filter((e) => !e.startsWith("PATH=") && !e.startsWith("HOME="))
    .map((e) => `-e ${JSON.stringify(e)}`)
    .join(" ");
  const networkFlag = config.NetworkMode ? `--network ${config.NetworkMode}` : "";
  const workdirFlag = config.WorkingDir ? `-w ${config.WorkingDir}` : "";
  const cmd = (config.Cmd || []).map((c) => JSON.stringify(c)).join(" ");

  const createCmd = [
    "docker create",
    `--name ${containerName}`,
    "--security-opt seccomp=unconfined",
    networkFlag,
    workdirFlag,
    envFlags,
    originalImage,
    cmd,
  ].filter(Boolean).join(" ");

  const newContainerId = execSync(createCmd, { stdio: "pipe", encoding: "utf-8" }).trim();

  // Extract checkpoint from image into Docker's internal checkpoint directory
  try { execSync("docker rm -f machinen-tmp", { stdio: "pipe" }); } catch {}
  execSync(`docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });

  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;

  try {
    // OrbStack: use nsenter to create dir and copy
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

  // Restore
  execSync(`docker start --checkpoint ${checkpointId} ${containerName}`, { stdio: "inherit" });

  return { newContainerId, checkpointId };
}
