import Docker from "dockerode";
import { checkPrerequisites } from "./preflight.mjs";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const CONTAINER_NAME = "session-poc";

async function main() {
  await checkPrerequisites(docker);

  // Look up the running container
  const container = docker.getContainer(CONTAINER_NAME);
  const info = await container.inspect();

  if (!info.State.Running) {
    console.error(`Container ${CONTAINER_NAME} is not running (status: ${info.State.Status})`);
    process.exit(1);
  }

  console.log(`Found running container: ${container.id}`);

  // Create a timestamped checkpoint ID
  const checkpointId = `checkpoint-${Date.now()}`;

  // Call Docker checkpoint create via the engine API.
  // Uses Docker's default checkpoint storage under
  // /var/lib/docker/containers/<id>/checkpoints/
  await new Promise((resolve, reject) => {
    docker.modem.dial(
      {
        method: "POST",
        path: `/containers/${container.id}/checkpoints`,
        options: {
          CheckpointID: checkpointId,
          Exit: true,
        },
        statusCodes: { 200: true, 201: true },
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      },
    );
  });

  console.log(`Checkpoint created successfully.`);
  console.log(`  ID: ${checkpointId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
