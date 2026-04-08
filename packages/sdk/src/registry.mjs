import { execSync, execFileSync } from "node:child_process";

const LOCAL_REGISTRY_CONTAINER = "machinen-registry";
const LOCAL_REGISTRY_PORT = 5001;

/** Start the local registry:2 container if it isn't already running. */
function ensureLocalRegistry() {
  const hostEnv = { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" };
  try {
    const state = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", LOCAL_REGISTRY_CONTAINER],
      { encoding: "utf-8", stdio: "pipe", env: hostEnv },
    ).trim();
    if (state === "running") {
      return;
    }
    execFileSync("docker", ["rm", "-f", LOCAL_REGISTRY_CONTAINER], { stdio: "pipe", env: hostEnv });
  } catch {}
  console.log("Starting local registry...");
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--restart=always",
      "--name",
      LOCAL_REGISTRY_CONTAINER,
      "-p",
      `${LOCAL_REGISTRY_PORT}:5000`,
      "registry:2",
    ],
    { stdio: "pipe", env: hostEnv },
  );
}

let _cached = null;

export function getRegistry() {
  if (process.env.MACHINEN_REGISTRY) {
    return { url: process.env.MACHINEN_REGISTRY, isLocal: true };
  }

  if (_cached) {
    return _cached;
  }

  const username = execSync("gh api user --jq .login", {
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();

  const token = execSync("gh auth token", {
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();

  // Verify the token has write:packages scope for ghcr.io push access
  const scopes = execSync("gh auth status 2>&1", {
    stdio: "pipe",
    encoding: "utf-8",
    shell: true,
  });
  const scopeLine = scopes.split("\n").find((l) => l.includes("Token scopes:")) || "";
  const tokenScopes = scopeLine.match(/Token scopes:\s*(.*)/)?.[1] || "";
  if (!tokenScopes.includes("write:packages")) {
    throw new Error(
      `Your GitHub token is missing the 'write:packages' scope required to push images to ghcr.io.\n` +
        `Run: gh auth refresh -s write:packages`,
    );
  }

  _cached = {
    url: `ghcr.io/${username}`,
    username,
    token,
  };

  return _cached;
}

export function ensureDockerLogin() {
  const reg = getRegistry();
  if (reg.isLocal) {
    ensureLocalRegistry();
    return;
  }
  const { username, token } = reg;
  execFileSync("docker", ["login", "ghcr.io", "-u", username, "--password-stdin"], {
    input: token,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function remoteDockerLogin(sshScriptFn, ip) {
  const reg = getRegistry();
  if (reg.isLocal) {
    return;
  }
  const { username, token } = reg;
  sshScriptFn(ip, `echo "${token}" | docker login ghcr.io -u "${username}" --password-stdin`, {
    stdio: "pipe",
  });
}
