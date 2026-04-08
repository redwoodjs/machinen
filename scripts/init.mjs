import Docker from "dockerode";
import { checkPrerequisites } from "./preflight.mjs";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const IMAGE = "ubuntu:24.04";
const CONTAINER_NAME = "session-poc";
const CMD = ["bash", "-c", 'i=0; while true; do echo "Counter: $i"; i=$((i+1)); sleep 2; done'];

async function main() {
  await checkPrerequisites(docker);

  // Pull image if not already present
  console.log(`Pulling ${IMAGE}...`);
  await new Promise((resolve, reject) => {
    docker.pull(IMAGE, (err, stream) => {
      if (err) {
        return reject(err);
      }
      docker.modem.followProgress(stream, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
  console.log(`Image ${IMAGE} ready.`);

  // Remove existing container with the same name if it exists
  try {
    const existing = docker.getContainer(CONTAINER_NAME);
    const info = await existing.inspect();
    console.log(`Removing existing container ${CONTAINER_NAME}...`);
    if (info.State.Running) {
      await existing.stop();
    }
    await existing.remove();
  } catch {
    // Container doesn't exist — that's fine
  }

  // Create container
  const container = await docker.createContainer({
    Image: IMAGE,
    name: CONTAINER_NAME,
    Cmd: CMD,
    HostConfig: {
      SecurityOpt: ["seccomp=unconfined"],
      NetworkMode: "host",
    },
  });

  console.log(`Container created: ${container.id}`);

  // Start container
  await container.start();
  console.log(`Container ${CONTAINER_NAME} started.`);

  const info = await container.inspect();
  console.log(`Status: ${info.State.Status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
