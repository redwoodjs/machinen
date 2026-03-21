import { execSync } from "node:child_process";

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

  _cached = {
    url: `ghcr.io/${username}`,
    username,
    token,
  };

  return _cached;
}

export function ensureDockerLogin() {
  const { url, username, token } = getRegistry();
  execSync(`echo ${token} | docker login ghcr.io -u ${username} --password-stdin`, {
    stdio: "pipe",
  });
}

export function remoteDockerLogin(sshFn, ip) {
  const { username, token } = getRegistry();
  sshFn(ip, `echo '${token}' | docker login ghcr.io -u ${username} --password-stdin`, {
    stdio: "pipe",
  });
}
