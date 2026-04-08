import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTAINER_NAME = "session-poc";
const IMAGE = "ubuntu:24.04";
const CMD = `bash -c 'i=0; while true; do echo "Counter: $i"; i=$((i+1)); sleep 2; done'`;
const SYNC_DIR = path.join(os.homedir(), "sync-dir");
const SERVER_NAME = "machinen-test";
const SERVER_TYPE = "cax11";
const LOCATION = "nbg1";
const STATE_FILE = path.join(os.homedir(), ".machinen-remote-state.json");

// --- State ---

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(updates) {
  const state = { ...loadState(), ...updates };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  return state;
}

// --- Hetzner CLI ---

function hcloud(args, { json = true } = {}) {
  const fullArgs = json ? [...args, "-o", "json"] : args;
  const result = spawnSync("hcloud", fullArgs, { stdio: "pipe", encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`hcloud ${args.slice(0, 2).join(" ")} failed: ${result.stderr}`);
  }
  if (json && result.stdout.trim()) {
    return JSON.parse(result.stdout);
  }
  return result.stdout;
}

// --- SSH ---

function findLocalSSHPubKey() {
  const sshDir = path.join(os.homedir(), ".ssh");
  for (const name of ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"]) {
    const p = path.join(sshDir, name);
    if (fs.existsSync(p)) {
      return { path: p, content: fs.readFileSync(p, "utf-8").trim() };
    }
  }
  return null;
}

function ensureSSHKey() {
  const keyInfo = findLocalSSHPubKey();
  if (!keyInfo) {
    console.error("No SSH public key found in ~/.ssh/");
    process.exit(1);
  }

  const sshKeys = hcloud(["ssh-key", "list"]);
  const existing = sshKeys.find((k) => k.public_key.trim() === keyInfo.content);
  if (existing) {
    return existing.id;
  }

  const result = spawnSync(
    "hcloud",
    [
      "ssh-key",
      "create",
      "--name",
      `machinen-${os.hostname()}`,
      "--public-key-from-file",
      keyInfo.path,
    ],
    { stdio: "pipe", encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to create SSH key: ${result.stderr}`);
  }

  const updatedKeys = hcloud(["ssh-key", "list"]);
  const created = updatedKeys.find((k) => k.public_key.trim() === keyInfo.content);
  if (!created) {
    throw new Error("SSH key created but not found in list");
  }
  return created.id;
}

function ssh(ip, cmd, { stdio = "inherit" } = {}) {
  return spawnSync(
    "ssh",
    [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      `root@${ip}`,
      cmd,
    ],
    { stdio, encoding: "utf-8" },
  );
}

// --- Commands ---

const CLOUD_INIT = `#!/bin/bash
set -e
apt-get update
apt-get install -y docker.io rsync \\
  build-essential git libprotobuf-dev libprotobuf-c-dev \\
  protobuf-c-compiler protobuf-compiler python3-protobuf \\
  libcap-dev libnl-3-dev libnet-dev uuid-dev pkg-config \\
  iproute2 ca-certificates
git clone --depth 1 https://github.com/checkpoint-restore/criu.git /tmp/criu
make -C /tmp/criu -j$(nproc) criu
cp /tmp/criu/criu/criu /usr/local/sbin/criu
rm -rf /tmp/criu
mkdir -p /etc/docker
echo '{"experimental": true}' > /etc/docker/daemon.json
systemctl restart docker
docker pull ${IMAGE}
touch /root/.machinen-ready
`;

async function cmdProvision() {
  const sshKeyId = ensureSSHKey();

  // Check for existing server
  const descResult = spawnSync("hcloud", ["server", "describe", SERVER_NAME, "-o", "json"], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (descResult.status === 0) {
    const server = JSON.parse(descResult.stdout);
    const ip = server.public_net.ipv4.ip;
    console.log(`Already exists: ${ip}`);
    saveState({ serverId: server.id, ip });
    return;
  }

  console.log(`Creating ${SERVER_TYPE} in ${LOCATION}...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-"));
  const cloudInitPath = path.join(tmpDir, "cloud-init.sh");
  fs.writeFileSync(cloudInitPath, CLOUD_INIT);

  try {
    const createResult = spawnSync(
      "hcloud",
      [
        "server",
        "create",
        "--name",
        SERVER_NAME,
        "--type",
        SERVER_TYPE,
        "--image",
        "ubuntu-24.04",
        "--location",
        LOCATION,
        "--ssh-key",
        String(sshKeyId),
        "--user-data-from-file",
        cloudInitPath,
        "-o",
        "json",
      ],
      { stdio: "pipe", encoding: "utf-8" },
    );

    if (createResult.status !== 0) {
      throw new Error(`Failed to create server: ${createResult.stderr}`);
    }

    const result = JSON.parse(createResult.stdout);
    const server = result.server;
    const ip = server.public_net.ipv4.ip;
    saveState({ serverId: server.id, ip });
    console.log(`Server: ${ip}`);
    console.log("Installing Docker + CRIU (streaming cloud-init log)...");

    const start = Date.now();
    let lastLineCount = 0;

    while (Date.now() - start < 10 * 60 * 1000) {
      const ready = ssh(ip, "cat /root/.machinen-ready 2>/dev/null", { stdio: "pipe" });
      if (ready.status === 0) {
        console.log(`Ready in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
        return;
      }

      const log = ssh(
        ip,
        `tail -n +${lastLineCount + 1} /var/log/cloud-init-output.log 2>/dev/null`,
        { stdio: "pipe" },
      );
      if (log.status === 0 && log.stdout.trim()) {
        const lines = log.stdout.trimEnd().split("\n");
        for (const line of lines) {
          console.log(`  ${line}`);
        }
        lastLineCount += lines.length;
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("Timed out");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function cmdFreeze() {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const checkpointId = `checkpoint-${Date.now()}`;
  console.log(`Freezing ${CONTAINER_NAME}...`);
  execSync(
    `docker checkpoint create --checkpoint-dir ${SYNC_DIR} ${CONTAINER_NAME} ${checkpointId}`,
    { stdio: "inherit" },
  );
  saveState({ checkpointId });
  console.log(`Checkpoint: ${checkpointId}`);
}

function cmdRestore() {
  const { ip, checkpointId } = loadState();
  if (!ip) {
    console.error("Run 'provision' first.");
    process.exit(1);
  }
  if (!checkpointId) {
    console.error("Run 'freeze' first.");
    process.exit(1);
  }

  console.log(`Syncing to ${ip}...`);
  execSync(
    `rsync -azP --delete -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR" ${SYNC_DIR}/ root@${ip}:~/sync-dir/`,
    { stdio: "inherit" },
  );

  ssh(ip, `docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, { stdio: "pipe" });

  console.log("Creating container...");
  const createResult = ssh(
    ip,
    `docker create --name ${CONTAINER_NAME} --security-opt seccomp=unconfined --network host ${IMAGE} ${CMD}`,
    { stdio: "pipe" },
  );
  const containerId = createResult.stdout.trim();
  console.log(`Container: ${containerId}`);

  // Copy checkpoint into Docker's internal checkpoint directory
  console.log("Copying checkpoint into Docker's checkpoint store...");
  ssh(
    ip,
    `mkdir -p /var/lib/docker/containers/${containerId}/checkpoints && cp -r ~/sync-dir/${checkpointId} /var/lib/docker/containers/${containerId}/checkpoints/${checkpointId}`,
  );

  console.log("Restoring...");
  ssh(ip, `docker start --checkpoint ${checkpointId} ${CONTAINER_NAME}`);

  console.log("\nLogs:");
  ssh(ip, `docker logs --tail 10 ${CONTAINER_NAME}`);
}

function cmdLogs() {
  const { ip } = loadState();
  if (!ip) {
    console.error("Run 'provision' first.");
    process.exit(1);
  }
  ssh(ip, `docker logs -f ${CONTAINER_NAME}`);
}

function cmdDestroy() {
  const { serverId } = loadState();
  if (serverId) {
    hcloud(["server", "delete", String(serverId)], { json: false });
  } else {
    const descResult = spawnSync("hcloud", ["server", "describe", SERVER_NAME, "-o", "json"], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (descResult.status !== 0) {
      console.log("Nothing to destroy.");
      return;
    }
    hcloud(["server", "delete", SERVER_NAME], { json: false });
  }
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {}
  console.log("Destroyed.");
}

// --- Main ---

const commands = {
  provision: cmdProvision,
  freeze: cmdFreeze,
  restore: cmdRestore,
  logs: cmdLogs,
  destroy: cmdDestroy,
};

async function main() {
  const action = process.argv[2];
  if (!action || !commands[action]) {
    console.log(`Usage: node scripts/remote-test.mjs <command>

  provision  Create server with Docker+CRIU (takes ~3min first time)
  freeze     Checkpoint the local container
  restore    Sync checkpoint + restore on remote
  logs       Tail remote container logs
  destroy    Tear down the server`);
    process.exit(action ? 1 : 0);
  }
  await commands[action]();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
