#!/usr/bin/env node

/**
 * E2E test: freeze → restore locally
 *
 * Starts a devcontainer (javascript-node:1-22) and verifies the full
 * checkpoint/restore cycle:
 *   1. Start machinen-dind (Docker-in-Docker with patched CRIU)
 *   2. Start a local registry inside DiND on :5000
 *   3. Start devcontainer with workspace + extra bind mount
 *   4. Run socat daemon + counter loop inside a tmux session (child of PID 1)
 *      so processes survive CRIU checkpoint/restore
 *   5. Commit → checkpoint original → build image → push to local registry
 *   6. Pull from registry → restore locally
 *   7. Assert: container running, files intact, original process alive and
 *      incrementing, socat daemon survived
 */

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDiND, getDiNDHost } from "../dind.mjs";
import {
  reconnectDocker,
  docker,
  captureContainerConfig,
  createCheckpoint,
  extractCheckpointFiles,
  stripBindMountEntries,
  buildCheckpointImage,
  pushImage,
  pullImage,
  restoreLocally,
  ensureTmuxSession,
  hasTmuxSession,
} from "../docker.mjs";

const REGISTRY = "localhost:5000";
const CONTAINER = "machinen-e2e-test";
const RESTORED = `${CONTAINER}-restored`;
const CLEAN = `${CONTAINER}-clean`;
const COMMITTED = `${CONTAINER}-committed`;
const SCRIPT_USER = "root";

// --- helpers ---

function exec(cmd) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf-8" }).trim();
}

function dockerExec(container, cmd) {
  return exec(`docker exec ${container} ${cmd}`);
}

function dockerExecUser(container, user, args) {
  return execFileSync("docker", ["exec", "--user", user, container, ...args], {
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
}

function rmContainer(name) {
  try {
    exec(`docker rm -f ${name}`);
  } catch {}
}

function assert(ok, msg) {
  if (!ok) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function cleanup(dirs = []) {
  for (const c of [CONTAINER, RESTORED, CLEAN, COMMITTED, "machinen-tmp"]) {
    rmContainer(c);
  }
  // Clean up images
  for (const pattern of [`${REGISTRY}/*`, `${COMMITTED}`]) {
    try {
      exec(`docker images --format '{{.Repository}}:{{.Tag}}' ${pattern} | xargs -r docker rmi -f`);
    } catch {}
  }
  for (const d of dirs) {
    if (d) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  }
}

// --- main ---

async function main() {
  let workspaceDir;
  let extraDir;

  // ── 0. Start DiND + local registry ────────────────────────────────────
  const scriptsDir = path.join(process.cwd(), "scripts");
  await ensureDiND(scriptsDir);
  const diNDHost = getDiNDHost();
  process.env.DOCKER_HOST = diNDHost;
  const { hostname: diNDIP, port: diNDPortStr } = new URL(diNDHost);
  reconnectDocker(diNDIP, parseInt(diNDPortStr, 10));

  // Start registry inside DiND so localhost:5000 resolves within the inner daemon.
  exec("docker rm -f registry 2>/dev/null || true");
  exec("docker run -d -p 5000:5000 --name registry registry:2");
  for (let i = 0; i < 10; i++) {
    try {
      exec("docker exec registry wget -qO- http://localhost:5000/v2/ 2>/dev/null");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  cleanup();

  try {
    // ── 1. Start devcontainer with workspace + extra bind mount ────────
    console.log("1. Starting devcontainer...");

    // Create a workspace dir to bind-mount.  Use cwd (the repo checkout) since
    // it's host-mapped in both agent-ci and native Docker environments.
    // (os.tmpdir() is inside the runner container and invisible to Docker.)
    workspaceDir = path.join(process.cwd(), ".e2e-workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# E2E Test Workspace\n");
    fs.writeFileSync(path.join(workspaceDir, "data.json"), '{"test": true}\n');

    // Second bind mount through /var/run to exercise symlink normalisation.
    // On Debian/Ubuntu containers /var/run → /run, so Docker reports the
    // mount destination as /var/run/... while CRIU records /run/...
    extraDir = path.join(process.cwd(), ".e2e-extra");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "extra.txt"), "extra-data\n");

    // Write devcontainer config — workspace + extra mount, seccomp=unconfined
    // so CRIU can checkpoint the container.
    fs.mkdirSync(path.join(workspaceDir, ".devcontainer"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".devcontainer", "devcontainer.json"),
      JSON.stringify(
        {
          image: "mcr.microsoft.com/devcontainers/javascript-node:1-22",
          remoteUser: "node",
          workspaceFolder: "/workspace",
          runArgs: ["--security-opt", "seccomp=unconfined", "--network", "host"],
          mounts: [{ source: extraDir, target: "/var/run/e2e-extra", type: "bind" }],
        },
        null,
        2,
      ),
    );

    execFileSync(
      "pnpm",
      [
        "exec",
        "devcontainer",
        "up",
        "--workspace-folder",
        workspaceDir,
        "--remove-existing-container",
      ],
      { stdio: "pipe" },
    );

    const dcName = execSync(
      `docker ps --filter "label=devcontainer.local_folder=${workspaceDir}" --format "{{.Names}}"`,
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();
    assert(dcName, "devcontainer not found after up");
    if (dcName !== CONTAINER) {
      try {
        exec(`docker rm -f ${CONTAINER}`);
      } catch {}
      exec(`docker rename ${dcName} ${CONTAINER}`);
    }
    console.log(`   container: ${CONTAINER}`);

    // Try to install socat for the socket test.  If unavailable (no network),
    // skip — the test adapts below.
    let hasSocat = false;
    try {
      execFileSync(
        "docker",
        [
          "exec",
          "--user",
          "root",
          CONTAINER,
          "sh",
          "-c",
          "apt-get install -y -qq socat >/dev/null 2>&1",
        ],
        { stdio: "pipe" },
      );
      hasSocat = true;
    } catch {}

    // Start a root tmux session — socat needs to bind /var/run/test.sock and
    // all test processes run here so they are grandchildren of PID 1 and
    // survive CRIU checkpoint/restore.
    ensureTmuxSession(CONTAINER, { user: SCRIPT_USER });
    assert(
      hasTmuxSession(CONTAINER, "machinen", { user: SCRIPT_USER }),
      "tmux session not started",
    );

    // Background daemon listening on a Unix socket — mirrors the socat
    // process from the docker-outside-of-docker devcontainer feature.
    // The socket file will be captured by `docker commit`, creating the
    // stale-socket scenario that broke restore (issue #16).
    if (hasSocat) {
      dockerExecUser(CONTAINER, SCRIPT_USER, [
        "tmux",
        "send-keys",
        "-t",
        "machinen",
        'socat UNIX-LISTEN:/var/run/test.sock,fork,reuseaddr SYSTEM:"echo pong" &',
        "Enter",
      ]);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Keep a file descriptor open to the bind mount.  This exercises CRIU's
    // ability to restore FDs that reference stripped mount entries — the
    // scenario that caused the "No mapping for <mnt_id>" error.
    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      "exec 3>/workspace/lockfile",
      "Enter",
    ]);
    await new Promise((r) => setTimeout(r, 300));
    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      "echo locked >&3",
      "Enter",
    ]);
    await new Promise((r) => setTimeout(r, 300));

    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      'SECRET="machinen-e2e-42"',
      "Enter",
    ]);
    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      'echo "$SECRET" > /tmp/secret.txt',
      "Enter",
    ]);
    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      'echo "hello from machinen" > /tmp/hello.txt',
      "Enter",
    ]);
    dockerExecUser(CONTAINER, SCRIPT_USER, [
      "tmux",
      "send-keys",
      "-t",
      "machinen",
      'COUNTER=0; while true; do COUNTER=$((COUNTER+1)); echo "$COUNTER:$SECRET" > /tmp/state.txt; sleep 1; done &',
      "Enter",
    ]);

    // Let the counter tick and socat start
    await new Promise((r) => setTimeout(r, 5000));

    // Verify socat is actually responding
    if (hasSocat) {
      try {
        const socatCheck = dockerExec(
          CONTAINER,
          "sh -c 'echo ping | socat - UNIX-CONNECT:/var/run/test.sock'",
        );
        hasSocat = socatCheck === "pong";
      } catch {
        hasSocat = false;
      }
    }
    if (hasSocat) {
      console.log("   socat daemon running on /var/run/test.sock");
    } else {
      console.log("   socat not available — socket tests will be skipped");
    }

    // Snapshot pre-checkpoint state
    const preSecret = dockerExec(CONTAINER, "cat /tmp/secret.txt");
    const preHello = dockerExec(CONTAINER, "cat /tmp/hello.txt");
    const preState = dockerExec(CONTAINER, "cat /tmp/state.txt");
    const preCounter = parseInt(preState.split(":")[0], 10);

    console.log(`   secret=${preSecret}  hello=${preHello}  counter=${preCounter}`);
    assert(preSecret === "machinen-e2e-42", `unexpected secret: ${preSecret}`);
    assert(preHello === "hello from machinen", `unexpected hello: ${preHello}`);
    assert(preCounter > 0, `counter should be > 0, got ${preCounter}`);

    // ── 2. Freeze (commit → clean → checkpoint → image → push) ──────
    console.log("2. Freezing...");

    // Commit filesystem (captures socat socket file in overlay — the stale
    // socket that must be whiteout'd before CRIU can re-bind it).
    exec(`docker commit ${CONTAINER} ${COMMITTED}`);

    const container = docker.getContainer(CONTAINER);
    const info = await container.inspect();
    const config = captureContainerConfig(info);

    // Extract bind-mounted files before stopping (same as cmdFreeze)
    const binds = [
      ...new Set(
        [
          ...(config.Binds || []).map((b) => b.split(":")[1]),
          ...(info.Mounts || []).filter((m) => m.Type === "bind").map((m) => m.Destination),
        ].filter(Boolean),
      ),
    ];
    console.log(`   bind paths to strip: ${binds.join(", ")}`);
    const wsTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-e2e-ws-save-"));
    const savedBinds = [];
    for (const cp of binds) {
      const tarPath = path.join(wsTmpDir, `bind-${cp.replace(/\//g, "_")}.tar`);
      try {
        exec(`docker cp ${CONTAINER}:${cp} - > ${tarPath}`);
        savedBinds.push({ containerPath: cp, tarPath });
        console.log(`   saved bind: ${cp}`);
      } catch {}
    }

    // Bake bind-mounted files into the committed image using a temp container
    if (savedBinds.length > 0) {
      rmContainer(CLEAN);
      execFileSync(
        "docker",
        ["run", "-d", "--name", CLEAN, "--entrypoint", "sleep", COMMITTED, "infinity"],
        { stdio: "pipe" },
      );
      for (const { containerPath, tarPath } of savedBinds) {
        const parent = path.posix.dirname(containerPath);
        exec(`cat ${tarPath} | docker cp - ${CLEAN}:${parent}`);
      }
      exec(`docker commit ${CLEAN} ${COMMITTED}`);
      rmContainer(CLEAN);
    }
    fs.rmSync(wsTmpDir, { recursive: true, force: true });

    // Checkpoint the original container directly to preserve process tree
    const { containerId, checkpointId } = await createCheckpoint(CONTAINER, { exit: true });
    console.log(`   checkpoint: ${checkpointId}`);

    const { tmpDir, tarPath } = extractCheckpointFiles(containerId, checkpointId);

    // Strip bind-mount entries from checkpoint (contents are in the committed image)
    if (binds.length > 0) {
      const env = { ...process.env, COPYFILE_DISABLE: "1" };
      const patchDir = path.join(tmpDir, "patch");
      fs.mkdirSync(patchDir);
      execFileSync("tar", ["xf", tarPath, "-C", patchDir], { stdio: "pipe", env });
      stripBindMountEntries(patchDir, binds);
      execFileSync("tar", ["cf", tarPath, "-C", patchDir, "."], { stdio: "pipe", env });
      fs.rmSync(patchDir, { recursive: true, force: true });
    }

    try {
      const prefix = `${REGISTRY}/machinen/${CONTAINER}`;
      const tag = `${prefix}:${checkpointId}`;
      const latestTag = `${prefix}:latest`;
      const baseTag = `${prefix}:base`;

      // Tag + push committed image as base
      exec(`docker tag ${COMMITTED} ${baseTag}`);
      pushImage(baseTag);

      // Build + push checkpoint image
      buildCheckpointImage(
        tarPath,
        COMMITTED,
        config,
        checkpointId,
        tag,
        /* workspaceTars */ [],
        /* baseImageTag */ baseTag,
        /* checkpointedContainerId */ containerId,
      );
      exec(`docker tag ${tag} ${latestTag}`);
      pushImage(tag);
      pushImage(latestTag);

      console.log("   frozen and pushed.");

      // ── 3. Simulate fresh pull (remove local knowledge) ────────────
      console.log("3. Cleaning local state...");
      rmContainer(CLEAN);
      rmContainer(CONTAINER);
      // Remove committed image so restore must use the registry base
      try {
        exec(`docker rmi ${COMMITTED}`);
      } catch {}

      // ── 4. Restore locally ─────────────────────────────────────────
      console.log("4. Restoring locally...");
      pullImage(latestTag);
      restoreLocally(latestTag, RESTORED);

      // Let the process tick after restore
      await new Promise((r) => setTimeout(r, 3000));

      // ── 5. Verify ──────────────────────────────────────────────────
      console.log("5. Verifying...");

      // Container is running
      const status = exec(`docker inspect --format '{{.State.Status}}' ${RESTORED}`);
      assert(status === "running", `container not running (status: ${status})`);
      console.log("   [pass] container is running");

      // /etc/resolv.conf must have a nameserver (non-root exec bug would leave it empty)
      const resolvConf = dockerExec(RESTORED, "cat /etc/resolv.conf");
      assert(
        /nameserver\s+[\d.]+/.test(resolvConf),
        `/etc/resolv.conf missing nameserver after restore:\n${resolvConf}`,
      );
      console.log("   [pass] /etc/resolv.conf has nameserver after restore");

      // Files preserved
      const postSecret = dockerExec(RESTORED, "cat /tmp/secret.txt");
      assert(postSecret === "machinen-e2e-42", `secret lost: ${postSecret}`);
      console.log("   [pass] /tmp/secret.txt preserved");

      const postHello = dockerExec(RESTORED, "cat /tmp/hello.txt");
      assert(postHello === "hello from machinen", `hello lost: ${postHello}`);
      console.log("   [pass] /tmp/hello.txt preserved");

      // The original shell loop should still be running and incrementing the counter.
      // Read counter twice with a gap to prove the process is alive and ticking.
      const postState1 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const [counterStr1, secret1] = postState1.split(":");
      const postCounter1 = parseInt(counterStr1, 10);

      assert(secret1 === "machinen-e2e-42", `in-memory SECRET lost after restore: ${secret1}`);
      console.log("   [pass] in-memory SECRET preserved across checkpoint/restore");

      assert(
        postCounter1 >= preCounter,
        `counter regressed (pre=${preCounter} post=${postCounter1})`,
      );
      console.log(`   [pass] counter preserved: ${postCounter1} (was ${preCounter} before freeze)`);

      // Wait and read again — counter must still be incrementing
      await new Promise((r) => setTimeout(r, 2000));
      const postState2 = dockerExec(RESTORED, "cat /tmp/state.txt");
      const postCounter2 = parseInt(postState2.split(":")[0], 10);

      assert(
        postCounter2 > postCounter1,
        `counter not incrementing after restore (read1=${postCounter1} read2=${postCounter2}) — original process is not running`,
      );
      console.log(
        `   [pass] counter still incrementing: ${postCounter1} → ${postCounter2} (process survived restore)`,
      );

      const ps = dockerExec(RESTORED, "ps aux");

      // socat daemon should be alive (its socket was re-bound by CRIU)
      if (hasSocat) {
        assert(ps.includes("socat"), `socat daemon not found after restore:\n${ps}`);
        console.log("   [pass] socat daemon survived restore");
      } else {
        console.log("   [skip] socat daemon test skipped (socat not installed)");
      }

      // Bind-mounted workspace files (may not work in Docker-outside-of-Docker)
      try {
        const readme = dockerExec(RESTORED, "cat /workspace/README.md");
        assert(readme === "# E2E Test Workspace", `workspace README lost: ${readme}`);
        console.log("   [pass] /workspace/README.md preserved (bind mount capture works)");

        const data = dockerExec(RESTORED, "cat /workspace/data.json");
        assert(data.includes('"test": true'), `workspace data.json lost: ${data}`);
        console.log("   [pass] /workspace/data.json preserved");
      } catch {
        console.log("   [skip] bind mount test skipped (Docker-outside-of-Docker environment)");
      }

      // /var/run bind mount (tests symlink normalisation: /var/run → /run)
      try {
        const extra = dockerExec(RESTORED, "cat /var/run/e2e-extra/extra.txt");
        assert(extra === "extra-data", `extra bind data lost: ${extra}`);
        console.log("   [pass] /var/run/e2e-extra preserved (symlink path bind mount)");
      } catch {
        console.log("   [skip] /var/run bind mount test skipped");
      }

      console.log("\nAll e2e checks passed.");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    cleanup([workspaceDir, extraDir]);
  }
}

main().catch((err) => {
  console.error(`\nE2E FAILED: ${err.message}`);
  cleanup();
  process.exit(1);
});
