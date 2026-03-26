import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

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
 * Uses the container's bridge IP so this works from both the Mac host
 * (via OrbStack's bridge routing) and from sibling containers in CI
 * (same Docker bridge).  Unlike tcp://127.0.0.1:2375, the bridge IP
 * is reachable when the caller is itself a container.
 */
export function getDiNDHost() {
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
    const cgroup = fs.readFileSync("/proc/self/cgroup", "utf-8");
    const match = cgroup.match(/\/docker\/([a-f0-9]{12,64})/);
    if (!match) return null;

    const containerId = match[1];
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
    "-v", "machinen-docker-data:/var/lib/docker",
    ...mountArgs,
    "-e", "DOCKER_TLS_CERTDIR=",
    DIND_IMAGE,
    // Pass daemon flags to dockerd-entrypoint.sh (the docker:dind entrypoint)
    "--host", `tcp://0.0.0.0:${DIND_PORT}`,
    "--host", "unix:///var/run/docker.sock",
    ...(process.env.MACHINEN_REGISTRY ? ["--insecure-registry", process.env.MACHINEN_REGISTRY] : []),
  ], { stdio: "pipe", ...HOST_DOCKER_OPTS });

  // Wait for the inner dockerd to be ready using docker exec (avoids TCP
  // connectivity issues when the caller is itself a container).
  console.log("Waiting for inner Docker daemon...");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execFileSync("docker", ["exec", DIND_CONTAINER, "docker", "info"],
        { stdio: "pipe", ...HOST_DOCKER_OPTS });
      console.log("machinen-dind ready.");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Dump logs to help diagnose startup failures
  let logs = "";
  try {
    logs = execFileSync("docker", ["logs", "--tail", "50", DIND_CONTAINER],
      { encoding: "utf-8", stdio: "pipe", ...HOST_DOCKER_OPTS });
  } catch {}
  throw new Error(`machinen-dind did not become ready within 60 seconds.\n${logs}`);
}
