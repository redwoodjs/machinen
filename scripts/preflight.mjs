import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run a command inside OrbStack's Docker VM using the nsenter trick.
 * Skips -n (network namespace) — we only need mount/uts/ipc/pid.
 */
function execInDockerVM(cmd) {
  return execSync(
    `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -u -i sh -c ${JSON.stringify(cmd)}`,
    { stdio: "pipe", encoding: "utf-8" }
  );
}

/**
 * Test whether `docker checkpoint` actually works by creating a throwaway
 * container and attempting a checkpoint. Returns true if it succeeds.
 */
async function testCheckpointWorks(docker) {
  const testName = "criu-preflight-test";
  let container;
  try {
    // Clean up any leftover test container
    try {
      const old = docker.getContainer(testName);
      try {
        await old.stop();
      } catch {}
      await old.remove({ force: true });
    } catch {}

    container = await docker.createContainer({
      Image: "alpine",
      name: testName,
      Cmd: ["sleep", "300"],
      HostConfig: { SecurityOpt: ["seccomp=unconfined"] },
    });
    await container.start();

    // Give it a moment to fully start
    await new Promise((r) => setTimeout(r, 1000));

    execSync(
      `docker checkpoint create ${testName} test-cp`,
      { stdio: "pipe", encoding: "utf-8" }
    );
    return true;
  } catch (err) {
    console.error("Checkpoint test failed:", err.stderr?.toString() || err.message);
    return false;
  } finally {
    if (container) {
      try {
        await container.stop();
      } catch {}
      try {
        await container.remove({ force: true });
      } catch {}
    }
  }
}

/**
 * Build CRIU from source and install the binary into the Docker VM.
 */
function installCRIUInDockerVM() {
  const dockerfilePath = path.join(__dirname, "Dockerfile.criu-builder");

  console.log("Building CRIU from source (this may take a few minutes)...");
  execSync(
    `docker build -f ${dockerfilePath} -t criu-builder ${__dirname}`,
    { stdio: "inherit" }
  );

  // Extract the bundled criu-dist directory (binary + shared libs) from the image
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "criu-"));
  const distTar = path.join(tmpDir, "criu-dist.tar");

  try {
    execSync("docker rm -f criu-builder-tmp 2>/dev/null || true", {
      stdio: "pipe",
    });
    execSync("docker create --name criu-builder-tmp criu-builder", {
      stdio: "pipe",
    });
    // Copy the entire criu-dist directory as a tar
    execSync(`docker cp criu-builder-tmp:/criu-dist - > ${distTar}`, {
      stdio: ["pipe", "pipe", "inherit"],
      shell: true,
    });
    execSync("docker rm criu-builder-tmp", { stdio: "pipe" });

    // Install into the Docker VM via nsenter.
    // Pipe the tar through stdin; nsenter extracts it into /opt/criu/.
    console.log("Installing CRIU into the Docker VM...");

    execSync(
      `cat ${distTar} | docker run --rm -i --privileged --pid=host alpine nsenter -t 1 -m -u -i sh -c "mkdir -p /opt/criu && tar xf - -C /opt/criu --strip-components=1 && ln -sf /opt/criu/bin/criu /usr/local/sbin/criu"`,
      { stdio: ["pipe", "inherit", "inherit"] }
    );

    console.log("CRIU installed at /opt/criu/ in Docker VM.");
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Check that Docker experimental mode is enabled and CRIU is available.
 * On macOS with OrbStack, CRIU must be installed inside the Docker VM.
 * This script will auto-build and install it if missing.
 */
export async function checkPrerequisites(docker) {
  const info = await docker.info();
  const isOrbStack =
    info.Name?.includes("orbstack") ||
    info.OperatingSystem?.toLowerCase().includes("orbstack");

  // --- Docker experimental mode ---
  if (!info.ExperimentalBuild) {
    if (isOrbStack) {
      console.log("Enabling Docker experimental mode in OrbStack...");
      const configPath = path.join(
        os.homedir(),
        ".orbstack",
        "config",
        "docker.json"
      );
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch {
        // File doesn't exist or is invalid — start fresh
      }
      config.experimental = true;
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log("Restarting OrbStack Docker engine...");
      execSync("orb restart docker", { stdio: "inherit" });
      // Re-check after restart
      const updatedInfo = await docker.info();
      if (!updatedInfo.ExperimentalBuild) {
        console.error(
          "ERROR: Failed to enable Docker experimental mode after restart."
        );
        process.exit(1);
      }
      console.log("Docker experimental mode enabled.");
    } else {
      console.error(
        "ERROR: Docker experimental mode is not enabled.\n" +
          "  Checkpointing requires experimental mode.\n" +
          '  Add {"experimental": true} to /etc/docker/daemon.json and restart Docker.'
      );
      process.exit(1);
    }
  }

  // --- CRIU availability ---
  if (isOrbStack) {
    // Pull alpine ahead of time (needed for both test and nsenter)
    try {
      execSync("docker image inspect alpine >/dev/null 2>&1", {
        stdio: "pipe",
      });
    } catch {
      console.log("Pulling alpine image...");
      execSync("docker pull alpine", { stdio: "inherit" });
    }

    console.log("Testing if docker checkpoint works...");
    if (await testCheckpointWorks(docker)) {
      console.log("CRIU is available — docker checkpoint works.");
    } else {
      console.log("docker checkpoint failed — CRIU binary is missing.");
      installCRIUInDockerVM();

      // Verify it works now
      console.log("Verifying CRIU installation...");
      if (await testCheckpointWorks(docker)) {
        console.log("CRIU installed and verified — docker checkpoint works.");
      } else {
        console.error(
          "ERROR: CRIU was installed but docker checkpoint still fails.\n" +
            "  Try restarting OrbStack and running this script again."
        );
        process.exit(1);
      }
    }

    console.log(
      "\nNote: CRIU in the Docker VM is not persisted across OrbStack restarts.\n" +
        "  If OrbStack restarts, run this preflight again to reinstall CRIU.\n"
    );
  } else {
    // Native Linux — just check for the criu binary
    try {
      execSync("criu --version", { stdio: "pipe" });
    } catch {
      console.error(
        "ERROR: CRIU is not installed.\n" +
          "  Checkpointing requires CRIU (Linux only).\n" +
          "  Install it with: sudo apt-get install -y criu"
      );
      process.exit(1);
    }
  }
}
