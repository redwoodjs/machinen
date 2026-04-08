import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dockerExec } from "./docker";
import hetzner from "./providers/hetzner";

let provider = hetzner;

export function getProvider() {
  return provider;
}

// --- Discovery (stateless) ---

const MACHINEN_PREFIX = "machinen-";

/**
 * Find all machinen containers (local Docker) and servers (Hetzner).
 */
export function listMachines() {
  const machines: { name: string; status: string; location: string; ip?: string }[] = [];

  // Local containers named machinen-*
  try {
    const out = dockerExec([
      "ps",
      "-a",
      "--filter",
      "name=^machinen-",
      "--format",
      "{{.Names}}\t{{.Status}}",
    ]).trim();
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
      const existing = machines.find((m) => m.name === s.name);
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

export const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "ConnectTimeout=10",
];

export function ssh(ip: string, cmd: string, { stdio = "inherit" as any, nothrow = false } = {}) {
  const result = spawnSync("ssh", [...SSH_OPTS, `root@${ip}`, cmd], { stdio, encoding: "utf-8" });
  if (!nothrow && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `Remote command failed (exit ${result.status}): ${cmd}${stderr ? `\n${stderr}` : ""}`,
    );
  }
  return result;
}

/**
 * Run a shell script on a remote server via stdin.
 * Avoids all escaping issues — the script is piped directly to bash,
 * never passed through shell argument parsing.
 */
export function sshScript(
  ip: string,
  script: string,
  { stdio = "inherit" as any, nothrow = false } = {},
) {
  const result = spawnSync("ssh", [...SSH_OPTS, `root@${ip}`, "bash -s"], {
    input: script,
    stdio: [undefined, ...(Array.isArray(stdio) ? stdio.slice(1) : [stdio, stdio])] as any,
    encoding: "utf-8",
  });
  if (!nothrow && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`Remote script failed (exit ${result.status})${stderr ? `\n${stderr}` : ""}`);
  }
  return result;
}

// --- Server Provisioning ---

function cloudInit() {
  const patchCriuTty = readFileSync(new URL("./patch-criu-tty.py", import.meta.url), "utf-8");
  return `#!/bin/bash
set -e
apt-get update
apt-get install -y \
  build-essential git libprotobuf-dev libprotobuf-c-dev \
  protobuf-c-compiler protobuf-compiler python3-protobuf \
  libcap-dev libnl-3-dev libnet-dev uuid-dev pkg-config \
  iproute2 ca-certificates curl
# Install Docker CE 28 from Docker's official apt repo.
# Docker 29 / runc 1.3.x introduced a regression causing CRIU restore to fail
# with "type RESTORE errno 0".  Pin to Docker 28 (runc 1.2.x) to match DiND.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
DOCKER_VERSION=$(apt-cache madison docker-ce | awk '/5:28\\./ {print $3; exit}')
apt-get install -y docker-ce="$DOCKER_VERSION" docker-ce-cli="$DOCKER_VERSION" containerd.io docker-buildx-plugin
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Install devcontainer CLI
npm install -g @devcontainers/cli
# Build patched CRIU from source (patch removes tty_verify_ctty pid_real check
# so tmux sessions can be checkpointed/restored across machines)
git clone --depth 1 https://github.com/checkpoint-restore/criu.git /tmp/criu
python3 - /tmp/criu/criu/tty.c <<'PYEOF'
${patchCriuTty}PYEOF
make -C /tmp/criu -j$(nproc) criu
cp /tmp/criu/criu/criu /usr/local/sbin/criu
rm -rf /tmp/criu
# Configure CRIU — match DiND's runc.conf exactly.
# ext-mount-map entries let CRIU treat /dev submounts as externally provided
# by runc, which is required for cross-machine restore.
mkdir -p /etc/criu
printf 'ext-unix-sk\\nfile-locks\\next-mount-map /dev:/dev\\next-mount-map /dev/pts:/dev/pts\\next-mount-map /dev/mqueue:/dev/mqueue\\next-mount-map /dev/shm:/dev/shm\\nskip-mnt /proc/interrupts\\nskip-mnt /proc/keys\\nskip-mnt /proc/timer_list\\nskip-mnt /sys/firmware\\n' > /etc/criu/runc.conf
# Enable Docker experimental mode with cgroupfs driver.
# cgroupfs driver is required for CRIU checkpoint/restore: it creates
# deterministic cgroup paths (/docker/<id>) that CRIU stores in cgroup.img.
# systemd driver creates /system.slice/docker-<id>.scope paths that differ
# between the freeze and restore containers, causing CRIU restore to fail.
mkdir -p /etc/docker
echo '{"experimental": true, "exec-opts": ["native.cgroupdriver=cgroupfs"]}' > /etc/docker/daemon.json
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
    const reachable = ssh(existing.ip, "true", { stdio: "pipe", nothrow: true });
    if (reachable.status !== 0) {
      throw new Error(
        `Server ${name} (${existing.ip}) is not responding.\n` +
          `If it's unrecoverable, destroy it first:\n` +
          `  machinen destroy ${name} --remote`,
      );
    }
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
    const ready = ssh(server.ip, "cat /root/.machinen-ready 2>/dev/null", {
      stdio: "pipe",
      nothrow: true,
    });
    if (ready.status === 0) {
      console.log(`Ready in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
      return server.ip;
    }

    const log = ssh(
      server.ip,
      `tail -n +${lastLineCount + 1} /var/log/cloud-init-output.log 2>/dev/null`,
      { stdio: "pipe", nothrow: true },
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
  throw new Error("Timed out waiting for server");
}

export function remoteFreeze(ip, containerName, registry) {
  const checkpointId = `checkpoint-${Date.now()}`;

  console.log(`Freezing remote container ${containerName}...`);
  ssh(ip, `docker checkpoint create ${containerName} ${checkpointId}`);

  const inspectRaw = ssh(
    ip,
    `docker inspect --format '{{.Id}}\\t{{.Config.Image}}\\t{{json .Config}}' ${containerName}`,
    { stdio: "pipe" },
  ).stdout.trim();
  const [containerId, originalImage, configRaw] = inspectRaw.split("\t");

  const imageTag = `${registry}/${containerName}:${checkpointId}`;
  const latestTag = `${registry}/${containerName}:latest`;
  const baseTag = `${registry}/${containerName}:base-${checkpointId}`;
  const baseLatestTag = `${registry}/${containerName}:base`;

  // Tag the original image as the base — restore needs identical layers
  ssh(ip, `docker tag ${originalImage} ${baseTag} && docker tag ${originalImage} ${baseLatestTag}`);

  ssh(
    ip,
    [
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
    ].join(" && "),
  );

  console.log("Pushing from remote...");
  ssh(
    ip,
    `docker push ${imageTag} && docker push ${latestTag} && docker push ${baseTag} && docker push ${baseLatestTag}`,
  );

  return { checkpointId, imageTag, latestTag, baseTag };
}

export function remoteRestore(ip, containerName, imageTag, _registry) {
  console.log(`Pulling ${imageTag} on remote...`);
  ssh(ip, `docker pull ${imageTag}`);

  const labelsRaw = ssh(ip, `docker inspect --format '{{json .Config.Labels}}' ${imageTag}`, {
    stdio: "pipe",
  }).stdout.trim();
  const labels = JSON.parse(labelsRaw);
  const _config = JSON.parse(labels["machinen.config"]);
  const checkpointId = labels["machinen.checkpoint-id"];
  const baseImageTag = labels["machinen.base-image"];
  const oldContainerId = labels["machinen.container-id"];

  // CRIU stores cgroup paths in cgroup.img.  cgroupfs cgroup driver creates
  // paths like /docker/<id> which CRIU patches to the new container ID on
  // restore.  The systemd cgroup driver creates /system.slice/docker-<id>.scope
  // paths instead — a different shape that CRIU can't find, causing errno 0.
  // Ensure cgroupfs is active before creating the restore container.
  // Ensure runc.conf matches DiND — existing servers provisioned before this
  // fix may only have ext-unix-sk; the ext-mount-map entries are required for
  // CRIU to treat /dev submounts as externally provided by runc.
  sshScript(
    ip,
    `
printf 'ext-unix-sk\\nfile-locks\\next-mount-map /dev:/dev\\next-mount-map /dev/pts:/dev/pts\\next-mount-map /dev/mqueue:/dev/mqueue\\next-mount-map /dev/shm:/dev/shm\\nskip-mnt /proc/interrupts\\nskip-mnt /proc/keys\\nskip-mnt /proc/timer_list\\nskip-mnt /sys/firmware\\n' > /etc/criu/runc.conf
`,
  );

  const cgroupDriver = ssh(ip, "docker info --format '{{.CgroupDriver}}'", {
    stdio: "pipe",
  }).stdout.trim();
  if (cgroupDriver !== "cgroupfs") {
    console.log(
      `Switching Docker cgroup driver from ${cgroupDriver} to cgroupfs (required for CRIU restore)...`,
    );
    sshScript(
      ip,
      `
python3 -c "
import json
with open('/etc/docker/daemon.json') as f:
    cfg = json.load(f)
opts = [o for o in cfg.get('exec-opts', []) if not o.startswith('native.cgroupdriver=')]
opts.append('native.cgroupdriver=cgroupfs')
cfg['exec-opts'] = opts
cfg['experimental'] = True
with open('/etc/docker/daemon.json', 'w') as f:
    json.dump(cfg, f)
"
systemctl restart docker
# Wait for Docker to be ready
for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
`,
    );
  }

  // The restore container must use the same image layers as the checkpointed
  // container. Pull the base image if available, fall back to imageTag.
  const createImage = baseImageTag || imageTag;
  if (baseImageTag) {
    ssh(ip, `docker pull ${baseImageTag}`);
  }

  ssh(ip, `docker rm -f ${containerName} 2>/dev/null || true`, { stdio: "pipe" });

  const createResult = ssh(
    ip,
    `docker create --name ${containerName} --security-opt seccomp=unconfined --network host ${createImage} sleep infinity`,
    { stdio: "pipe" },
  );
  const newContainerId = createResult.stdout.trim();

  // Extract checkpoint data into Docker's checkpoint directory
  ssh(ip, `docker rm -f machinen-tmp 2>/dev/null || true`, { stdio: "pipe" });
  ssh(ip, `docker create --name machinen-tmp ${imageTag}`, { stdio: "pipe" });
  const checkpointDir = `/var/lib/docker/containers/${newContainerId}/checkpoints/${checkpointId}`;
  ssh(
    ip,
    [
      `mkdir -p ${checkpointDir}`,
      `docker cp machinen-tmp:/checkpoint/. ${checkpointDir}/`,
      `docker rm machinen-tmp`,
    ].join(" && "),
  );

  // Patch checkpoint:
  // 1. Replace original container ID with new ID in all .img files (binary-safe).
  // 2. Strip Docker-managed mount entries whose parent mount IDs are kernel-assigned
  //    and differ on the restore machine.  Without stripping these CRIU aborts with
  //    "No mapping for mountpoint" (surfaces as errno 0: unknown).
  //    Mirrors stripBindMountEntries() in docker.mjs.
  console.log("Patching checkpoint...");
  const patchScript = `
import os, glob, struct

checkpoint_dir = ${JSON.stringify(checkpointDir)}
old = ${oldContainerId ? JSON.stringify(oldContainerId) : "None"}
new_id = ${JSON.stringify(newContainerId)}

# 1. Container ID patch
if old and old != new_id:
    old_b, new_b = old.encode(), new_id.encode()
    for f in glob.glob(os.path.join(checkpoint_dir, "*.img")):
        d = open(f, "rb").read()
        if old_b in d:
            open(f, "wb").write(d.replace(old_b, new_b))
            print("  patched:", os.path.basename(f))

# 2. Strip Docker-managed bind mounts whose parent mount IDs are kernel-assigned
# and differ on the restore machine.  Mirrors stripBindMountEntries() in docker.mjs.
# Strip:  /proc/*, /sys/*, /etc/hosts, /etc/hostname, /etc/resolv.conf
# Keep:   /, /proc, /sys, /dev, /dev/* (needed for PTY and mount-ID resolution)
STRIP_PREFIXES = ("/proc/", "/sys/")
STRIP_EXACT = {"/etc/hosts", "/etc/hostname", "/etc/resolv.conf"}
def get_mountpoint(payload):
    pos = 0
    while pos < len(payload):
        tag, shift = 0, 0
        while True:
            if pos >= len(payload): return None
            b = payload[pos]; pos += 1
            tag |= (b & 0x7f) << shift; shift += 7
            if not (b & 0x80): break
        field, wtype = tag >> 3, tag & 7
        if wtype == 0:
            while pos < len(payload) and payload[pos] & 0x80: pos += 1
            pos += 1
        elif wtype == 2:
            ln, sh2 = 0, 0
            while True:
                if pos >= len(payload): return None
                b = payload[pos]; pos += 1
                ln |= (b & 0x7f) << sh2; sh2 += 7
                if not (b & 0x80): break
            if field == 7:
                return payload[pos:pos+ln].decode("utf-8", errors="replace")
            pos += ln
        elif wtype == 5: pos += 4
        elif wtype == 1: pos += 8
        else: break
    return None
for f in glob.glob(os.path.join(checkpoint_dir, "mountpoints-*.img")):
    d = open(f, "rb").read()
    if len(d) < 8: continue
    header = d[:8]; pos = 8; entries = []
    while pos + 4 <= len(d):
        size = struct.unpack_from("<I", d, pos)[0]
        if size == 0 or pos + 4 + size > len(d): break
        entries.append(d[pos:pos+4+size]); pos += 4 + size
    kept = []; removed = 0
    for entry in entries:
        mp = get_mountpoint(entry[4:])
        if mp and (any(mp.startswith(p) for p in STRIP_PREFIXES) or mp in STRIP_EXACT):
            removed += 1
        else:
            kept.append(entry)
    if removed:
        open(f, "wb").write(header + b"".join(kept))
        print(f"  stripped {removed} bind-mount entries from {os.path.basename(f)}")
`;
  sshScript(ip, `python3 << 'PYEOF'\n${patchScript}\nPYEOF`);

  // Run docker start with a background watcher that copies restore.log before
  // containerd cleans up its temp dirs on failure.
  const captureLog = `/tmp/criu-restore-${Date.now()}.log`;
  console.log("Restoring on remote...");
  const restoreResult = sshScript(
    ip,
    `
# Watcher: poll known CRIU log locations and copy on first appearance.
# containerd cleans up /tmp/ctrd-checkpoint* on failure before a post-hoc
# search would find anything.
(while true; do
  sleep 0.1
  for f in /tmp/ctrd-checkpoint*/restore.log \\
            /run/containerd/io.containerd.runtime.v2.task/moby/*/restore.log \\
            ${checkpointDir}/restore.log; do
    [ -f "$f" ] && cp -u "$f" ${captureLog} 2>/dev/null || true
  done
done) &
WATCHER=$!

# Allow ICMP ping sockets for all GIDs so CRIU can restore them.
# The checkpointed container may hold open ping sockets (AF_INET/SOCK_DGRAM/IPPROTO_ICMP).
# CRIU restores FDs before restoring credentials, so the restore child needs this
# regardless of --cap-add NET_RAW (caps are set after FD creation).
# ping_group_range is per-netns; with --network host the restore child shares the
# host netns, so this sysctl covers it.
ORIG_PING_RANGE=$(cat /proc/sys/net/ipv4/ping_group_range | tr '\\t' ' ')
sysctl -w net.ipv4.ping_group_range="0 2147483647" >/dev/null

docker start --checkpoint ${checkpointId} ${containerName}
STATUS=$?

sysctl -w net.ipv4.ping_group_range="$ORIG_PING_RANGE" >/dev/null
sleep 0.5
kill $WATCHER 2>/dev/null || true
exit $STATUS
`,
    { stdio: "inherit", nothrow: true },
  );

  if (restoreResult.status !== 0) {
    const criuLog = ssh(ip, `cat ${captureLog} 2>/dev/null || echo '(no restore.log captured)'`, {
      stdio: "pipe",
      nothrow: true,
    }).stdout.trim();

    // Full Docker daemon log — unfiltered, last 60 lines
    const daemonLog = ssh(
      ip,
      `journalctl -u docker --no-pager --since "2 minutes ago" 2>/dev/null | tail -60 || true`,
      { stdio: "pipe", nothrow: true },
    ).stdout.trim();

    // dmesg for CRIU crash signals (segfault, OOM, killed)
    const dmesgLog = ssh(
      ip,
      `dmesg --time-format=reltime 2>/dev/null | grep -i 'criu\\|segfault\\|killed process\\|oom' | tail -20 || true`,
      { stdio: "pipe", nothrow: true },
    ).stdout.trim();

    // CRIU self-check — confirms binary works at all
    const criuCheck = ssh(ip, `criu check 2>&1 || true`, {
      stdio: "pipe",
      nothrow: true,
    }).stdout.trim();

    if (criuLog && !criuLog.startsWith("(no restore.log")) {
      console.error("CRIU restore log:\n" + criuLog.split("\n").slice(-50).join("\n"));
    } else {
      console.error("(no restore.log captured)");
    }
    console.error("\nDocker daemon log:\n" + daemonLog);
    if (dmesgLog) {
      console.error("\ndmesg (crashes):\n" + dmesgLog);
    }
    console.error("\ncriu check: " + criuCheck);
    ssh(ip, `uname -r`, { nothrow: true });
    throw new Error(
      `Remote restore failed (exit ${restoreResult.status}): docker start --checkpoint ${checkpointId} ${containerName}`,
    );
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
