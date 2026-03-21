import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hetzner from "./providers/hetzner.mjs";

const STATE_FILE = path.join(os.homedir(), ".machinen-state.json");

let provider = hetzner;

export function setProvider(p) {
  provider = p;
}

export function getProvider() {
  return provider;
}

// --- State (keyed by container name) ---

function loadAllState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveAllState(all) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2) + "\n");
}

export function loadState(key) {
  const all = loadAllState();
  if (key) return all[key] || {};
  const keys = Object.keys(all);
  return keys.length > 0 ? all[keys[0]] : {};
}

export function saveState(key, updates) {
  const all = loadAllState();
  all[key] = { ...(all[key] || {}), ...updates };
  saveAllState(all);
  return all[key];
}

export function deleteState(key) {
  const all = loadAllState();
  delete all[key];
  if (Object.keys(all).length === 0) {
    try { fs.unlinkSync(STATE_FILE); } catch {}
  } else {
    saveAllState(all);
  }
}

export function listState() {
  return loadAllState();
}

// --- SSH ---

export function ssh(ip, cmd, { stdio = "inherit" } = {}) {
  return spawnSync(
    "ssh",
    [
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      `root@${ip}`,
      cmd,
    ],
    { stdio, encoding: "utf-8" }
  );
}

// --- Server Provisioning ---

function cloudInit() {
  return `#!/bin/bash
set -e
apt-get update
apt-get install -y docker.io \\
  build-essential git libprotobuf-dev libprotobuf-c-dev \\
  protobuf-c-compiler protobuf-compiler python3-protobuf \\
  libcap-dev libnl-3-dev libnet-dev uuid-dev pkg-config \\
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
  stateKey,
  serverType = "cax11",
  location = "nbg1",
} = {}) {
  const sshKeyId = provider.ensureSSHKey();

  // Reuse existing server
  const existing = provider.getServer(name);
  if (existing) {
    console.log(`Server ${name} already exists: ${existing.ip}`);
    if (stateKey) saveState(stateKey, { serverId: existing.id, ip: existing.ip, serverName: name });
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

  if (stateKey) saveState(stateKey, { serverId: server.id, ip: server.ip, serverName: name });
  console.log(`Server: ${server.ip}`);
  console.log("Installing Docker + CRIU...");

  const start = Date.now();
  let lastLineCount = 0;

  while (Date.now() - start < 10 * 60 * 1000) {
    const ready = ssh(server.ip, "cat /root/.machinen-ready 2>/dev/null", { stdio: "pipe" });
    if (ready.status === 0) {
      console.log(`Ready in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
      return server.ip;
    }

    const log = ssh(
      server.ip,
      `tail -n +${lastLineCount + 1} /var/log/cloud-init-output.log 2>/dev/null`,
      { stdio: "pipe" }
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

  ssh(ip, [
    `TMPDIR=$(mktemp -d)`,
    `cd $TMPDIR`,
    `tar cf checkpoint.tar -C /var/lib/docker/containers/${containerId}/checkpoints/${checkpointId} .`,
    `cat > Dockerfile << 'DEOF'`,
    `FROM ${originalImage}`,
    `LABEL machinen.config='${configRaw.replace(/'/g, "'\\''")}'`,
    `LABEL machinen.checkpoint-id='${checkpointId}'`,
    `LABEL machinen.original-image='${originalImage}'`,
    `ADD checkpoint.tar /checkpoint/`,
    `DEOF`,
    `docker build -t ${imageTag} .`,
    `docker tag ${imageTag} ${latestTag}`,
    `rm -rf $TMPDIR`,
  ].join(" && "));

  console.log("Pushing from remote...");
  ssh(ip, `docker push ${imageTag} && docker push ${latestTag}`);

  return { checkpointId, imageTag, latestTag };
}

export function remoteRestore(ip, containerName, imageTag, registry) {
  console.log(`Pulling ${imageTag} on remote...`);
  ssh(ip, `docker pull ${imageTag}`);

  const labelsRaw = ssh(ip, `docker inspect --format '{{json .Config.Labels}}' ${imageTag}`, { stdio: "pipe" }).stdout.trim();
  const labels = JSON.parse(labelsRaw);
  const config = JSON.parse(labels["machinen.config"]);
  const checkpointId = labels["machinen.checkpoint-id"];
  const originalImage = labels["machinen.original-image"];

  ssh(ip, `docker rm -f ${containerName} 2>/dev/null || true`, { stdio: "pipe" });
  ssh(ip, `docker pull ${originalImage}`, { stdio: "pipe" });

  const createResult = ssh(ip, `docker create --name ${containerName} --security-opt seccomp=unconfined --network host ${originalImage} sleep infinity`, { stdio: "pipe" });
  const newContainerId = createResult.stdout.trim();

  ssh(ip, `docker rm -f machinen-tmp 2>/dev/null || true`, { stdio: "pipe" });
  ssh(ip, `docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });
  ssh(ip, [
    `mkdir -p /var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`,
    `docker cp machinen-tmp:/checkpoint/. /var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}/`,
    `docker rm machinen-tmp`,
  ].join(" && "));

  console.log("Restoring on remote...");
  ssh(ip, `docker start --checkpoint ${checkpointId} ${containerName}`);

  return { newContainerId, checkpointId };
}

export function destroyServer(name, stateKey) {
  const state = stateKey ? loadState(stateKey) : {};
  const serverId = state.serverId;

  if (serverId) {
    provider.deleteServer(serverId);
  } else if (name) {
    const existing = provider.getServer(name);
    if (!existing) {
      console.log("No server to destroy.");
      return;
    }
    provider.deleteServer(name);
  } else {
    console.log("No server to destroy.");
    return;
  }

  if (stateKey) {
    deleteState(stateKey);
  }
  console.log("Server destroyed.");
}
