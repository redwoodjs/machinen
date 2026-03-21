import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(__dirname, "..", "scripts");

function execInDockerVM(cmd) {
  return execSync(
    `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -u -i sh -c ${JSON.stringify(cmd)}`,
    { stdio: "pipe", encoding: "utf-8" }
  );
}

async function testCheckpointWorks(docker) {
  const testName = "criu-preflight-test";
  let container;
  try {
    try {
      const old = docker.getContainer(testName);
      try { await old.stop(); } catch {}
      await old.remove({ force: true });
    } catch {}

    container = await docker.createContainer({
      Image: "alpine",
      name: testName,
      Cmd: ["sleep", "300"],
      HostConfig: { SecurityOpt: ["seccomp=unconfined"] },
    });
    await container.start();
    await new Promise((r) => setTimeout(r, 1000));

    execSync(`docker checkpoint create ${testName} test-cp`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return true;
  } catch (err) {
    console.error("Checkpoint test failed:", err.stderr?.toString() || err.message);
    return false;
  } finally {
    if (container) {
      try { await container.stop(); } catch {}
      try { await container.remove({ force: true }); } catch {}
    }
  }
}

function installCRIUInDockerVM() {
  const dockerfilePath = path.join(scriptsDir, "Dockerfile.criu-builder");

  console.log("Building CRIU from source (this may take a few minutes)...");
  execSync(`docker build -f ${dockerfilePath} -t criu-builder ${scriptsDir}`, {
    stdio: "inherit",
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "criu-"));
  const distTar = path.join(tmpDir, "criu-dist.tar");

  try {
    execSync("docker rm -f criu-builder-tmp 2>/dev/null || true", { stdio: "pipe" });
    execSync("docker create --name criu-builder-tmp criu-builder", { stdio: "pipe" });
    execSync(`docker cp criu-builder-tmp:/criu-dist - > ${distTar}`, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: true,
    });
    execSync("docker rm criu-builder-tmp", { stdio: "pipe" });

    console.log("Installing CRIU into the Docker VM...");
    execSync(
      `cat ${distTar} | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m -u -i sh -c "mkdir -p /opt/criu && tar xf - -C /opt/criu --strip-components=1 && ln -sf /opt/criu/bin/criu /usr/local/sbin/criu"`,
      { stdio: ["pipe", "inherit", "inherit"] }
    );
    console.log("CRIU installed at /opt/criu/ in Docker VM.");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function checkPrerequisites(docker) {
  const info = await docker.info();
  const isOrbStack =
    info.Name?.includes("orbstack") ||
    info.OperatingSystem?.toLowerCase().includes("orbstack");

  if (!info.ExperimentalBuild) {
    if (isOrbStack) {
      console.log("Enabling Docker experimental mode in OrbStack...");
      const configPath = path.join(os.homedir(), ".orbstack", "config", "docker.json");
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
      config.experimental = true;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log("Restarting OrbStack Docker engine...");
      execSync("orb restart docker", { stdio: "inherit" });
      const updatedInfo = await docker.info();
      if (!updatedInfo.ExperimentalBuild) {
        throw new Error("Failed to enable Docker experimental mode after restart.");
      }
      console.log("Docker experimental mode enabled.");
    } else {
      throw new Error(
        "Docker experimental mode is not enabled.\n" +
        '  Add {"experimental": true} to /etc/docker/daemon.json and restart Docker.'
      );
    }
  }

  if (isOrbStack) {
    try {
      execSync("docker image inspect alpine >/dev/null 2>&1", { stdio: "pipe" });
    } catch {
      console.log("Pulling alpine image...");
      execSync("docker pull alpine", { stdio: "inherit" });
    }

    console.log("Testing if docker checkpoint works...");
    if (await testCheckpointWorks(docker)) {
      console.log("CRIU is available.");
    } else {
      console.log("CRIU missing — installing...");
      installCRIUInDockerVM();
      if (await testCheckpointWorks(docker)) {
        console.log("CRIU installed and verified.");
      } else {
        throw new Error("CRIU was installed but docker checkpoint still fails.");
      }
    }
  } else {
    try {
      execSync("criu --version", { stdio: "pipe" });
    } catch {
      throw new Error("CRIU is not installed. Install with: sudo apt-get install -y criu");
    }
  }
}

export function isOrbStack(info) {
  return (
    info.Name?.includes("orbstack") ||
    info.OperatingSystem?.toLowerCase().includes("orbstack")
  );
}
