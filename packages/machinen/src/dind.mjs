import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPTS_DIR = path.join(__dirname, "..", "..", "..", "scripts");

export const DIND_CONTAINER = "machinen-dind";
export const DIND_IMAGE = "machinen-dind";
export const DIND_PORT = 2375;

// Always use the host Docker socket for container management operations
// (starting/execing into machinen-dind itself), even when DOCKER_HOST is
// set to the inner daemon.
const HOST_DOCKER_OPTS = { env: { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" } };

/** Execute a shell command inside the running DiND container via the HOST Docker daemon. */
export function dindExec(cmd, opts = {}) {
  return execFileSync(
    "docker", ["exec", DIND_CONTAINER, "sh", "-c", cmd],
    { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS, ...opts },
  );
}

/**
 * Returns the DOCKER_HOST value for the inner DiND daemon.
 *
 * When running directly on the host (macOS), we use the published port on
 * localhost — bridge IPs are not reliably routable from the Mac host across
 * all Docker runtimes (Docker Desktop doesn't route them at all; OrbStack
 * may or may not).
 *
 * When running inside a container (e.g. agent-ci), localhost:2375 refers to
 * the container's own loopback, so we fall back to the bridge IP which is
 * reachable between sibling containers on the same Docker bridge.
 */
/** Detect whether we are running inside a Docker container. */
function isInContainer() {
  try {
    // cgroup v1: path contains /docker/<id>
    if (/\/docker\/[a-f0-9]/.test(fs.readFileSync("/proc/self/cgroup", "utf-8"))) return true;
  } catch {}
  try {
    // Docker creates /.dockerenv in every container
    fs.accessSync("/.dockerenv");
    return true;
  } catch {}
  return false;
}

export function getDiNDHost() {
  const inContainer = isInContainer();

  if (!inContainer) {
    return `tcp://127.0.0.1:${DIND_PORT}`;
  }

  const ip = execFileSync(
    "docker",
    ["inspect", "--format", "{{.NetworkSettings.IPAddress}}", DIND_CONTAINER],
    { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS },
  ).trim();
  if (!ip) throw new Error("machinen-dind has no bridge IP — is it running?");
  return `tcp://${ip}:${DIND_PORT}`;
}

/**
 * When this process runs inside a Docker container (e.g. agent-ci's runner),
 * the HOST Docker daemon doesn't know about the container's filesystem paths.
 * This function finds the HOST path that backs a given container path by
 * inspecting the container's own bind-mounts via the host Docker socket.
 * Returns null if not in a container or the path can't be mapped.
 */
function resolveHostPath(containerPath) {
  try {
    if (!isInContainer()) return null;

    // Try to extract container ID from cgroup (v1)
    let containerId;
    try {
      const cgroup = fs.readFileSync("/proc/self/cgroup", "utf-8");
      const match = cgroup.match(/\/docker\/([a-f0-9]{12,64})/);
      if (match) containerId = match[1];
    } catch {}

    // Fallback: Docker sets the hostname to the short container ID
    if (!containerId) {
      containerId = os.hostname();
    }
    const raw = execFileSync(
      "docker", ["inspect", containerId],
      { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS },
    );
    const mounts = JSON.parse(raw)[0]?.Mounts ?? [];

    // Sort longest destination first for most-specific match
    mounts.sort((a, b) => b.Destination.length - a.Destination.length);
    for (const m of mounts) {
      const dest = m.Destination;
      if (containerPath === dest || containerPath.startsWith(dest + "/")) {
        return m.Source + containerPath.slice(dest.length);
      }
    }
  } catch {}
  return null;
}

/**
 * Build the machinen-dind image (if not already present) and start the
 * container (if not already running).  Mounts the user home tree so the
 * inner Docker daemon can resolve workspace bind-mount paths from devcontainer CLI.
 */
export async function ensureDiND(scriptsDir = DEFAULT_SCRIPTS_DIR) {
  // Check if already running (via host Docker)
  try {
    const info = execFileSync(
      "docker", ["inspect", "--format", "{{.State.Status}}\t{{json .Args}}", DIND_CONTAINER],
      { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS },
    ).trim();
    const [state, argsJson] = info.split("\t");
    if (state === "running") {
      // Restart if the insecure-registry arg no longer matches MACHINEN_REGISTRY.
      const args = JSON.parse(argsJson ?? "[]");
      const idx = args.indexOf("--insecure-registry");
      const runningRegistry = idx !== -1 ? args[idx + 1] : null;
      const wantedRegistry = process.env.MACHINEN_REGISTRY ?? null;
      if (runningRegistry === wantedRegistry) {
        console.log("machinen-dind already running.");
        return;
      }
      console.log("machinen-dind registry config changed, restarting...");
      execFileSync("docker", ["rm", "-f", DIND_CONTAINER], { stdio: "pipe", ...HOST_DOCKER_OPTS });
    } else {
      // Container exists but is not running — remove it
      execFileSync("docker", ["rm", "-f", DIND_CONTAINER], { stdio: "pipe", ...HOST_DOCKER_OPTS });
    }
  } catch {
    // Container doesn't exist — continue to start
  }

  // Build image if not present
  try {
    execFileSync("docker", ["image", "inspect", DIND_IMAGE],
      { stdio: "pipe", ...HOST_DOCKER_OPTS });
    console.log("machinen-dind image found, skipping build.");
  } catch {
    console.log("Building machinen-dind image (includes CRIU build, ~3-5 min first time)...");
    execFileSync(
      "docker",
      ["build", "-f", path.join(scriptsDir, "Dockerfile.dind"), "-t", DIND_IMAGE, scriptsDir],
      { stdio: "inherit", ...HOST_DOCKER_OPTS },
    );
  }

  // Determine the path to mount into DiND so the inner Docker daemon can
  // resolve workspace bind-mount paths that devcontainer CLI passes in.
  //
  // When running inside a container (e.g. agent-ci), our cwd appears at a
  // Linux container path (e.g. /home/runner/_work/...) that the HOST Docker
  // daemon doesn't know about.  We inspect our own container to find the
  // underlying HOST path and mount that.
  //
  // When running directly on macOS we mount /Users; on Linux we mount /home.
  const cwd = process.cwd();
  const hostCwd = resolveHostPath(cwd);
  let workspaceMounts;
  if (hostCwd) {
    // Inside a container: mount just the workspace subtree from the host
    workspaceMounts = [`${hostCwd}:${cwd}`];
  } else if (process.platform === "darwin") {
    workspaceMounts = ["/Users:/Users"];
  } else {
    workspaceMounts = ["/home:/home"];
  }

  console.log("Starting machinen-dind...");
  const mountArgs = workspaceMounts.flatMap(m => ["-v", m]);
  execFileSync("docker", [
    "run", "-d",
    "--privileged",
    "--name", DIND_CONTAINER,
    "-p", `${DIND_PORT}:${DIND_PORT}`,
    "--add-host", "host.docker.internal:host-gateway",
    "-v", "machinen-docker-data:/var/lib/docker",
    ...mountArgs,
    "-e", "DOCKER_TLS_CERTDIR=",
    DIND_IMAGE,
    // Pass daemon flags to dockerd-entrypoint.sh (the docker:dind entrypoint)
    "--host", `tcp://0.0.0.0:${DIND_PORT}`,
    "--host", "unix:///var/run/docker.sock",
    ...(process.env.MACHINEN_REGISTRY ? ["--insecure-registry", process.env.MACHINEN_REGISTRY] : []),
  ], { stdio: "pipe", ...HOST_DOCKER_OPTS });

  // When MACHINEN_REGISTRY is a localhost address, the host-side registry is not
  // reachable from inside DinD (localhost is DinD's own loopback).  Set up an
  // iptables DNAT rule to forward that port to the host via host.docker.internal.
  //
  // Two extra steps are required for the DNAT to work:
  //  1. Remove the IPv6 localhost entry from /etc/hosts so that "localhost"
  //     resolves to 127.0.0.1 only — Docker (Go) tries IPv6 first and hangs.
  //  2. Enable route_localnet on all interfaces so the kernel allows routing
  //     packets from the loopback address to a real (non-loopback) destination.
  const reg = process.env.MACHINEN_REGISTRY;
  if (reg) {
    const m = reg.match(/^localhost:(\d+)$/);
    if (m) {
      const port = m[1];
      try {
        dindExec(
          // Force localhost → IPv4 only (prevents Docker from trying ::1 first)
          `cp /etc/hosts /tmp/hosts.noipv6 && sed -i '/^::1/d' /tmp/hosts.noipv6 && mount --bind /tmp/hosts.noipv6 /etc/hosts`,
        );
        dindExec(
          // Allow kernel to route DNAT'd packets from loopback to real IPs
          `for f in /proc/sys/net/ipv4/conf/*/route_localnet; do echo 1 > "$f"; done`,
        );
        dindExec(
          `iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport ${port} ` +
          `-j DNAT --to-destination $(getent hosts host.docker.internal | awk '{print $1}'):${port}`,
        );
      } catch (err) {
        console.warn(`Warning: could not forward registry port ${port} inside DinD: ${err.message}`);
      }
    }
  }

  // Wait for the inner dockerd to be ready using docker exec (avoids TCP
  // connectivity issues when the caller is itself a container).
  console.log("Waiting for inner Docker daemon...");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execFileSync("docker", ["exec", DIND_CONTAINER, "docker", "info"],
        { stdio: "pipe", ...HOST_DOCKER_OPTS });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const dumpLogsAndThrow = (msg) => {
    let logs = "";
    try {
      logs = execFileSync("docker", ["logs", "--tail", "50", DIND_CONTAINER],
        { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS });
    } catch {}
    throw new Error(`${msg}\n${logs}`);
  };

  if (Date.now() >= deadline) {
    dumpLogsAndThrow("machinen-dind did not become ready within 60 seconds.");
  }

  // The unix socket is up, but the TCP listener (port 2375) may still be
  // starting.  Check from *inside* DinD so we don't depend on the caller's
  // network topology (host vs sibling container).
  while (Date.now() < deadline) {
    try {
      execFileSync("docker", [
        "exec", DIND_CONTAINER,
        "docker", "-H", `tcp://127.0.0.1:${DIND_PORT}`, "info",
      ], { stdio: "pipe", ...HOST_DOCKER_OPTS });
      console.log("machinen-dind ready.");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  dumpLogsAndThrow("machinen-dind TCP listener did not become ready in time.");
}
