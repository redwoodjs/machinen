import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function hcloud(args, { json = true } = {}) {
  const fullArgs = json ? [...args, "-o", "json"] : args;
  const result = spawnSync("hcloud", fullArgs, { stdio: "pipe", encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`hcloud ${args.slice(0, 2).join(" ")} failed: ${result.stderr}`);
  }
  if (json && result.stdout.trim()) return JSON.parse(result.stdout);
  return result.stdout;
}

function findLocalSSHPubKey() {
  const sshDir = path.join(os.homedir(), ".ssh");
  for (const name of ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"]) {
    const p = path.join(sshDir, name);
    if (fs.existsSync(p)) return { path: p, content: fs.readFileSync(p, "utf-8").trim() };
  }
  return null;
}

export default {
  name: "hetzner",

  checkAuth() {
    try {
      execSync("hcloud version", { stdio: "pipe" });
    } catch {
      throw new Error(
        "hcloud CLI is not installed.\n" +
        "  Install: brew install hcloud (macOS) or see https://github.com/hetznercloud/cli\n" +
        "  Then: hcloud context create machinen"
      );
    }

    if (!process.env.HCLOUD_TOKEN) {
      try {
        const result = execSync("hcloud context active", { stdio: "pipe", encoding: "utf-8" });
        if (!result.trim()) throw new Error("no context");
      } catch {
        throw new Error(
          "hcloud is not authenticated.\n" +
          "  Run: hcloud context create machinen\n" +
          "  Or set HCLOUD_TOKEN environment variable."
        );
      }
    }
  },

  ensureSSHKey() {
    const keyInfo = findLocalSSHPubKey();
    if (!keyInfo) throw new Error("No SSH public key found in ~/.ssh/");

    const sshKeys = hcloud(["ssh-key", "list"]);
    const existing = sshKeys.find((k) => k.public_key.trim() === keyInfo.content);
    if (existing) return existing.id;

    const result = spawnSync("hcloud", [
      "ssh-key", "create",
      "--name", `machinen-${os.hostname()}`,
      "--public-key-from-file", keyInfo.path,
    ], { stdio: "pipe", encoding: "utf-8" });

    if (result.status !== 0) {
      throw new Error(`Failed to create SSH key: ${result.stderr}`);
    }

    const updatedKeys = hcloud(["ssh-key", "list"]);
    const created = updatedKeys.find((k) => k.public_key.trim() === keyInfo.content);
    if (!created) throw new Error("SSH key created but not found in list");
    return created.id;
  },

  getServer(name) {
    const result = spawnSync("hcloud", ["server", "describe", name, "-o", "json"], {
      stdio: "pipe", encoding: "utf-8",
    });
    if (result.status !== 0) return null;
    const server = JSON.parse(result.stdout);
    return { id: server.id, ip: server.public_net.ipv4.ip };
  },

  createServer({ name, type = "cax11", image = "ubuntu-24.04", location = "nbg1", sshKeyId, userData }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-"));
    const userDataPath = path.join(tmpDir, "cloud-init.sh");
    fs.writeFileSync(userDataPath, userData);

    try {
      const result = spawnSync("hcloud", [
        "server", "create",
        "--name", name,
        "--type", type,
        "--image", image,
        "--location", location,
        "--ssh-key", String(sshKeyId),
        "--user-data-from-file", userDataPath,
        "-o", "json",
      ], { stdio: "pipe", encoding: "utf-8" });

      if (result.status !== 0) {
        throw new Error(`Failed to create server: ${result.stderr}`);
      }

      const data = JSON.parse(result.stdout);
      return { id: data.server.id, ip: data.server.public_net.ipv4.ip };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },

  deleteServer(idOrName) {
    hcloud(["server", "delete", String(idOrName)], { json: false });
  },

  listServers(prefix) {
    const servers = hcloud(["server", "list"]);
    return servers
      .filter((s) => s.name.startsWith(prefix))
      .map((s) => ({ id: s.id, name: s.name, ip: s.public_net.ipv4.ip, status: s.status }));
  },
};
