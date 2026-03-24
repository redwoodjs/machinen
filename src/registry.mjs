import { execSync, execFileSync } from "node:child_process";

let _cached = null;

export function getRegistry() {
  if (_cached) return _cached;

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
  const scopeLine = scopes.split("\n").find(l => l.includes("Token scopes:")) || "";
  const tokenScopes = scopeLine.match(/Token scopes:\s*(.*)/)?.[1] || "";
  if (!tokenScopes.includes("write:packages")) {
    throw new Error(
      `Your GitHub token is missing the 'write:packages' scope required to push images to ghcr.io.\n` +
      `Run: gh auth refresh -s write:packages`
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
  const { url, username, token } = getRegistry();
  execFileSync("docker", ["login", "ghcr.io", "-u", username, "--password-stdin"], {
    input: token,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function remoteDockerLogin(sshScriptFn, ip) {
  const { username, token } = getRegistry();
  sshScriptFn(ip, `echo "${token}" | docker login ghcr.io -u "${username}" --password-stdin`, {
    stdio: "pipe",
  });
}
