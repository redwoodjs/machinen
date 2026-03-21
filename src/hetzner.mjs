import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const STATE_FILE = path.join(os.homedir(), ".machinen-state.json");

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
  // Return first entry for backwards compat
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

// --- Hetzner API ---

function getToken() {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("Set HETZNER_API_TOKEN environment variable.");
  return token;
}

export async function api(method, endpoint, body) {
  const token = getToken();
  const res = await fetch(`${HETZNER_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hetzner API ${method} ${endpoint}: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- SSH ---

function findLocalSSHPubKey() {
  const sshDir = path.join(os.homedir(), ".ssh");
  for (const name of ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"]) {
    const p = path.join(sshDir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").trim();
  }
  return null;
}

export async function ensureSSHKey() {
  const pubKey = findLocalSSHPubKey();
  if (!pubKey) throw new Error("No SSH public key found in ~/.ssh/");

  const { ssh_keys } = await api("GET", "/ssh_keys");
  const existing = ssh_keys.find((k) => k.public_key.trim() === pubKey);
  if (existing) return existing.id;

  const { ssh_key } = await api("POST", "/ssh_keys", {
    name: `machinen-${os.hostname()}`,
    public_key: pubKey,
  });
  return ssh_key.id;
}

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
  const sshKeyId = await ensureSSHKey();

  // Reuse existing server
  const { servers } = await api("GET", `/servers?name=${name}`);
  if (servers.length > 0) {
    const ip = servers[0].public_net.ipv4.ip;
    console.log(`Server ${name} already exists: ${ip}`);
    if (stateKey) saveState(stateKey, { serverId: servers[0].id, ip, serverName: name });
    return ip;
  }

  console.log(`Creating ${serverType} in ${location}...`);
  const { server } = await api("POST", "/servers", {
    name,
    server_type: serverType,
    image: "ubuntu-24.04",
    location,
    ssh_keys: [sshKeyId],
    user_data: cloudInit(),
  });

  const ip = server.public_net.ipv4.ip;
  if (stateKey) saveState(stateKey, { serverId: server.id, ip, serverName: name });
  console.log(`Server: ${ip}`);
  console.log("Installing Docker + CRIU...");

  const start = Date.now();
  let lastLineCount = 0;

  while (Date.now() - start < 10 * 60 * 1000) {
    const ready = ssh(ip, "cat /root/.machinen-ready 2>/dev/null", { stdio: "pipe" });
    if (ready.status === 0) {
      console.log(`Ready in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
      return ip;
    }

    const log = ssh(
      ip,
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

  // Package checkpoint as image and push to registry
  const containerId = ssh(ip, `docker inspect --format '{{.Id}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();
  const originalImage = ssh(ip, `docker inspect --format '{{.Config.Image}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();
  const configRaw = ssh(ip, `docker inspect --format '{{json .Config}}' ${containerName}`, { stdio: "pipe" }).stdout.trim();

  const imageTag = `${registry}/${containerName}:${checkpointId}`;
  const latestTag = `${registry}/${containerName}:latest`;

  // Build checkpoint image on remote
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

  // Read labels
  const labelsRaw = ssh(ip, `docker inspect --format '{{json .Config.Labels}}' ${imageTag}`, { stdio: "pipe" }).stdout.trim();
  const labels = JSON.parse(labelsRaw);
  const config = JSON.parse(labels["machinen.config"]);
  const checkpointId = labels["machinen.checkpoint-id"];
  const originalImage = labels["machinen.original-image"];

  // Remove existing container
  ssh(ip, `docker rm -f ${containerName} 2>/dev/null || true`, { stdio: "pipe" });

  // Pull base image
  ssh(ip, `docker pull ${originalImage}`, { stdio: "pipe" });

  // Create container
  const createResult = ssh(ip, `docker create --name ${containerName} --security-opt seccomp=unconfined --network host ${originalImage} sleep infinity`, { stdio: "pipe" });
  const newContainerId = createResult.stdout.trim();

  // Extract checkpoint
  ssh(ip, `docker rm -f machinen-tmp 2>/dev/null || true`, { stdio: "pipe" });
  ssh(ip, `docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });
  ssh(ip, [
    `mkdir -p /var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`,
    `docker cp machinen-tmp:/checkpoint/. /var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}/`,
    `docker rm machinen-tmp`,
  ].join(" && "));

  // Restore
  console.log("Restoring on remote...");
  ssh(ip, `docker start --checkpoint ${checkpointId} ${containerName}`);

  return { newContainerId, checkpointId };
}

export async function destroyServer(name, stateKey) {
  const state = stateKey ? loadState(stateKey) : {};
  const serverId = state.serverId;

  if (serverId) {
    await api("DELETE", `/servers/${serverId}`);
  } else if (name) {
    const { servers } = await api("GET", `/servers?name=${name}`);
    if (servers.length === 0) {
      console.log("No server to destroy.");
      return;
    }
    await api("DELETE", `/servers/${servers[0].id}`);
  } else {
    console.log("No server to destroy.");
    return;
  }

  if (stateKey) {
    deleteState(stateKey);
  }
  console.log("Server destroyed.");
}
