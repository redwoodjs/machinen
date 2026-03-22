import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hetzner from "./providers/hetzner.mjs";

let provider = hetzner;

export function setProvider(p) {
  provider = p;
}

export function getProvider() {
  return provider;
}

// --- Discovery (stateless) ---

const MACHINEN_PREFIX = "machinen-";

/**
 * Find all machinen containers (local Docker) and servers (Hetzner).
 */
export function listMachines() {
  const machines = [];

  // Local containers named machinen-*
  try {
    const out = execSync(
      `docker ps -a --filter "name=^machinen-" --format "{{.Names}}\t{{.Status}}"`,
      { stdio: "pipe", encoding: "utf-8" }
    ).trim();
    if (out) {
      for (const line of out.split("\n")) {
        const [name, status] = line.split("\t");
        if (name.startsWith(MACHINEN_PREFIX)) {
          machines.push({ name, status, location: "local" });
        }
      }
    }
  } catch {}

  // Remote servers
  try {
    const servers = provider.listServers(MACHINEN_PREFIX);
    for (const s of servers) {
      const existing = machines.find(m => m.name === s.name);
      if (existing) {
        existing.ip = s.ip;
        existing.location = "local+remote";
      } else {
        machines.push({ name: s.name, ip: s.ip, status: s.status, location: "remote" });
      }
    }
  } catch {}

  return machines;
}


// --- SSH ---

const SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"];

export function ssh(ip, cmd, { stdio = "inherit", nothrow = false } = {}) {
  const result = spawnSync(
    "ssh",
    [...SSH_OPTS, `root@${ip}`, cmd],
    { stdio, encoding: "utf-8" }
  );
  if (!nothrow && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Remote command failed (exit ${result.status}): ${cmd}${stderr ? `\n${stderr}` : ""}`);
  }
  return result;
}

/**
 * Run a shell script on a remote server via stdin.
 * Avoids all escaping issues — the script is piped directly to bash,
 * never passed through shell argument parsing.
 */
export function sshScript(ip, script, { stdio = "inherit", nothrow = false } = {}) {
  const result = spawnSync(
    "ssh",
    [...SSH_OPTS, `root@${ip}`, "bash -s"],
    { input: script, stdio: [undefined, ...(Array.isArray(stdio) ? stdio.slice(1) : [stdio, stdio])], encoding: "utf-8" }
  );
  if (!nothrow && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Remote script failed (exit ${result.status})${stderr ? `\n${stderr}` : ""}`);
  }
  return result;
}

// --- Server Provisioning ---

function cloudInit() {
  return `#!/bin/bash
set -e
apt-get update
apt-get install -y docker.io \
  build-essential git libprotobuf-dev libprotobuf-c-dev \
  protobuf-c-compiler protobuf-compiler python3-protobuf \
  libcap-dev libnl-3-dev libnet-dev uuid-dev pkg-config \
  iproute2 ca-certificates curl
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Install devcontainer CLI
npm install -g @devcontainers/cli
# Build CRIU from source
git clone --depth 1 https://github.com/checkpoint-restore/criu.git /tmp/criu
make -C /tmp/criu -j$(nproc) criu
cp /tmp/criu/criu/criu /usr/local/sbin/criu
rm -rf /tmp/criu
# Enable Docker experimental mode
mkdir -p /etc/docker
echo '{"experimental": true}' > /etc/docker/daemon.json
systemctl restart docker
touch /root/.machinen-ready
`;
}

export async function provisionServer({
  name = "machinen-server",
  serverType = "cax11",
  location = "nbg1",
} = {}) {
  const sshKeyId = provider.ensureSSHKey();

  // Reuse existing server
  const existing = provider.getServer(name);
  if (existing) {
    console.log(`Server ${name} already exists: ${existing.ip}`);
    return existing.ip;
  }

  console.log(`Creating ${serverType} in ${location}...`);
  const server = provider.createServer({
    name,
    type: serverType,
    image: "ubuntu-24.04",
    location,
    sshKeyId,
    userData: cloudInit(),
  });

  console.log(`Server: ${server.ip}`);
  console.log("Installing Docker + CRIU...");

  const start = Date.now();
  let lastLineCount = 0;

  while (Date.now() - start < 10 * 60 * 1000) {
    const ready = ssh(server.ip, "cat /root/.machinen-ready 2>/dev/null", { stdio: "pipe", nothrow: true });
    if (ready.status === 0) {
      console.log(`Ready in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
      return server.ip;
    }

    const log = ssh(
      server.ip,
      `tail -n +${lastLineCount + 1} /var/log/cloud-init-output.log 2>/dev/null`,
      { stdio: "pipe", nothrow: true }
    );
    if (log.status === 0 && log.stdout.trim()) {
      const lines = log.stdout.trimEnd().split("\n");
      for (const line of lines) console.log(`  ${line}`);
      lastLineCount += lines.length;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for server");
}

export function remoteFreeze(ip, containerName, registry) {
  const checkpointId = `checkpoint-${Date.now()}`;

  console.log(`Freezing remote container ${containerName}...`);
  ssh(ip, `docker checkpoint create ${containerName} ${checkpointId}`);

  const containerId = ssh(ip, `docker inspect --format '{{.Id}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();
  const originalImage = ssh(ip, `docker inspect --format '{{.Config.Image}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();
  const configRaw = ssh(ip, `docker inspect --format '{{json .Config}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();

  const imageTag = `${registry}/${containerName}:${checkpointId}`;
  const latestTag = `${registry}/${containerName}:latest`;
  const baseTag = `${registry}/${containerName}:base-${checkpointId}`;
  const baseLatestTag = `${registry}/${containerName}:base`;

  // Tag the original image as the base — restore needs identical layers
  ssh(ip, `docker tag ${originalImage} ${baseTag} && docker tag ${originalImage} ${baseLatestTag}`);

  ssh(ip, [
    `TMPDIR=$(mktemp -d)`,
    `cd $TMPDIR`,
    `tar cf checkpoint.tar -C /var/lib/docker/containers/${containerId}/checkpoints/${checkpointId} .`,
    `cat > Dockerfile << 'DEOF'`,
    `FROM ${originalImage}`,
    `LABEL machinen.config='${configRaw.replace(/'/g, "'\\''")}'`,
    `LABEL machinen.checkpoint-id='${checkpointId}'`,
    `LABEL machinen.original-image='${originalImage}'`,
    `LABEL machinen.base-image='${baseLatestTag}'`,
    `LABEL machinen.container-id='${containerId}'`,
    `ADD checkpoint.tar /checkpoint/`,
    `DEOF`,
    `docker build -t ${imageTag} .`,
    `docker tag ${imageTag} ${latestTag}`,
    `rm -rf $TMPDIR`,
  ].join(" && "));

  console.log("Pushing from remote...");
  ssh(ip, `docker push ${imageTag} && docker push ${latestTag} && docker push ${baseTag} && docker push ${baseLatestTag}`);

  return { checkpointId, imageTag, latestTag, baseTag };
}

export function remoteRestore(ip, containerName, imageTag, registry) {
  console.log(`Pulling ${imageTag} on remote...`);
  ssh(ip, `docker pull ${imageTag}`);

  const labelsRaw = ssh(ip, `docker inspect --format '{{json .Config.Labels}}' ${imageTag}`, { stdio: "pipe" }).stdout.trim();
  const labels = JSON.parse(labelsRaw);
  const config = JSON.parse(labels["machinen.config"]);
  const checkpointId = labels["machinen.checkpoint-id"];
  const baseImageTag = labels["machinen.base-image"];
  const oldContainerId = labels["machinen.container-id"];

  // The restore container must use the same image layers as the checkpointed
  // container. Pull the base image if available, fall back to imageTag.
  const createImage = baseImageTag || imageTag;
  if (baseImageTag) {
    ssh(ip, `docker pull ${baseImageTag}`);
  }

  ssh(ip, `docker rm -f ${containerName} 2>/dev/null || true`, { stdio: "pipe" });

  const createResult = ssh(ip, `docker create --name ${containerName} --security-opt seccomp=unconfined --network host ${createImage} sleep infinity`, { stdio: "pipe" });
  const newContainerId = createResult.stdout.trim();

  // Extract checkpoint data into Docker's checkpoint directory
  ssh(ip, `docker rm -f machinen-tmp 2>/dev/null || true`, { stdio: "pipe" });
  ssh(ip, `docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });
  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;
  ssh(ip, [
    `mkdir -p ${checkpointDir}`,
    `docker cp machinen-tmp:/checkpoint/. ${checkpointDir}/`,
    `docker rm machinen-tmp`,
  ].join(" && "));

  // Patch checkpoint: replace old container ID in mountpoints so CRIU can
  // find /etc/hosts, /etc/hostname, /etc/resolv.conf in the new container
  if (oldContainerId && oldContainerId !== newContainerId) {
    console.log("Patching checkpoint mount references...");
    ssh(ip, `find ${checkpointDir} -name 'mountpoints-*.img' -exec sed -i 's|${oldContainerId}|${newContainerId}|g' {} +`);
  }

  console.log("Restoring on remote...");
  try {
    ssh(ip, `docker start --checkpoint ${checkpointId} ${containerName}`);
  } catch (err) {
    console.error("\nCRIU restore failed. Collecting diagnostics...");
    ssh(ip, `uname -r`, { nothrow: true });
    ssh(ip, `criu check 2>&1 || true`, { nothrow: true });
    throw err;
  }

  return { newContainerId, checkpointId };
}

export function destroyServer(name) {
  const existing = provider.getServer(name);
  if (!existing) {
    console.log(`No server "${name}" to destroy.`);
    return;
  }
  provider.deleteServer(name);
  console.log(`Server ${name} destroyed.`);
}
