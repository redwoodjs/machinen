// Runnable demo for examples/node-http.
//
//   pnpm -F @machinen/example-node-http start
//
// First run: provision() boots the base rootfs, runs `apt-get install
// nodejs` inside, bakes a default cmd into the output image, and
// writes it to ./.cache/node-image.tar.gz. Subsequent runs: skip the
// provision and boot directly. Opens a host->guest port forward on
// 127.0.0.1:8080 -> guest:3000; the guest runs server.mjs mounted
// from the example's rootfs/ directory.
//
// Verify from another terminal:
//   curl http://localhost:8080/
//
// The equivalent CLI invocation (once .cache/node-image.tar.gz exists):
//   machinen boot ./.cache/node-image.tar.gz -p 8080:3000 \
//     --mount ./rootfs:/mnt/app

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { boot, provision } from "@machinen/runtime";

const here = dirname(new URL(import.meta.url).pathname);
const cacheDir = resolve(here, ".cache");
const imagePath = resolve(cacheDir, "node-image.tar.gz");

// In a published install the VMM package resolves the kernel + DTB
// for you; from a dev checkout we surface them via MACHINEN_ASSETS_DIR
// (same pattern scripts/smoke-tests.sh uses). provision() already
// resolves the base rootfs from this dir on its own.
const assetsDir = process.env.MACHINEN_ASSETS_DIR;
const kernel = assetsDir ? join(assetsDir, "Image-arm64") : undefined;
const dtb = assetsDir ? join(assetsDir, "virt-arm64.dtb") : undefined;

if (!existsSync(imagePath)) {
  process.stderr.write("provision: installing nodejs into base rootfs (first run)\n");
  mkdirSync(cacheDir, { recursive: true });
  const result = await provision({
    kernel,
    dtb,
    install: async (vm) => {
      await vm.exec("apt-get update");
      await vm.exec("apt-get install -y --no-install-recommends nodejs");
    },
    // Baked into /machinen-config.json inside the image. `boot({ image })`
    // runs this by default; no need for callers to repeat it.
    cmd: ["/usr/bin/node", "/mnt/app/server.mjs"],
    env: { NODE_NO_WARNINGS: "1" },
    out: imagePath,
  });
  process.stderr.write(
    `provision: done in ${Math.round(result.elapsedMs / 1000)}s (${Math.round(result.sizeBytes / 1024 / 1024)} MiB)\n`,
  );
}

const vm = await boot({
  image: imagePath,
  kernel,
  dtb,
  // Expose the example's rootfs/ dir inside the guest so edits to
  // server.mjs don't require rebuilding the image.
  mount: { host: resolve(here, "rootfs"), guest: "/mnt/app" },
  portForward: [{ hostPort: 8080, guestPort: 3000 }],
  timeoutMs: null,
});

vm.stdout.pipe(process.stdout);
vm.stderr.pipe(process.stderr);
process.on("SIGINT", () => void vm.kill());
process.on("SIGTERM", () => void vm.kill());

process.stderr.write("boot: VM up. curl http://localhost:8080/\n");
await vm.wait();
