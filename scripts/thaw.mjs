import Docker from "dockerode";
import { execSync } from "node:child_process";
import { checkPrerequisites } from "./preflight.mjs";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const CONTAINER_NAME = "session-poc";

async function main() {
  await checkPrerequisites(docker);

  // Ensure the container exists (freeze leaves it stopped)
  const container = docker.getContainer(CONTAINER_NAME);
  const info = await container.inspect();

  if (info.State.Running) {
    console.error(`Container ${CONTAINER_NAME} is already running.`);
    process.exit(1);
  }

  // List checkpoints for this container via the API
  const checkpoints = await new Promise((resolve, reject) => {
    docker.modem.dial(
      {
        method: "GET",
        path: `/containers/${container.id}/checkpoints`,
        statusCodes: { 200: true },
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      },
    );
  });

  if (!checkpoints || checkpoints.length === 0) {
    console.error("ERROR: No checkpoints found for this container.");
    console.error("  Run 'node scripts/freeze.mjs' first.");
    process.exit(1);
  }

  // Use the latest checkpoint (sorted by name, which includes timestamp)
  const sorted = checkpoints
    .map((c) => c.Name)
    .sort()
    .reverse();
  const checkpointId = sorted[0];
  console.log(`Using checkpoint: ${checkpointId}`);

  console.log(`Restoring container ${CONTAINER_NAME} from checkpoint...`);

  // Start the container from the checkpoint via CLI.
  // The Docker API's /start endpoint rejects request bodies (since v1.24)
  // and modem.dial can't send query-only POST requests cleanly.
  execSync(`docker start --checkpoint ${checkpointId} ${CONTAINER_NAME}`, {
    stdio: "inherit",
  });

  console.log(`Container ${CONTAINER_NAME} restored and running.`);

  // Show a few lines of logs to confirm continuity
  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail: 5,
  });
  console.log("\nRecent output:");
  console.log(logs.toString().replace(/^.{8}/gm, "  "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
