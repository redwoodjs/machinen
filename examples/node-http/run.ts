// Runnable demo for examples/node-http.
//
//   pnpm -F @machinen/example-node-http start
//
// First run: build() boots the base rootfs, runs `apt-get install
// nodejs` inside, and writes the resulting tarball to ./.cache/.
// Subsequent runs: skip the install and spawn directly. Opens a
// host->guest port forward on 127.0.0.1:8080 -> guest:3000; the guest
// runs server.js from the bundle overlay.
//
// Verify from another terminal:
//   curl http://localhost:8080/
//
// The equivalent CLI invocation (once you have a Node-capable base
// tarball on hand, e.g. copy ./.cache/node-rootfs.tar.gz out):
//   machinen run ./examples/node-http -p 8080:3000

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build, spawn } from "@machinen/runtime";

const here = dirname(new URL(import.meta.url).pathname);
const cacheDir = resolve(here, ".cache");
const snapshot = resolve(cacheDir, "node-rootfs.tar.gz");

// In a published install the VMM package resolves the kernel + DTB
// for you; from a dev checkout we surface them via MACHINEN_ASSETS_DIR
// (same pattern scripts/smoke-tests.sh uses). build() already resolves
// baseRootfs from this dir on its own.
const assetsDir = process.env.MACHINEN_ASSETS_DIR;
const kernel = assetsDir ? join(assetsDir, "Image-arm64") : undefined;
const dtb = assetsDir ? join(assetsDir, "virt-arm64.dtb") : undefined;

if (!existsSync(snapshot)) {
  process.stderr.write("build: installing nodejs into base rootfs (first run)\n");
  mkdirSync(cacheDir, { recursive: true });
  const result = await build({
    kernel,
    dtb,
    install: async (vm) => {
      await vm.exec("apt-get update");
      await vm.exec("apt-get install -y --no-install-recommends nodejs");
    },
    out: snapshot,
  });
  process.stderr.write(
    `build: done in ${Math.round(result.elapsedMs / 1000)}s (${Math.round(result.sizeBytes / 1024 / 1024)} MiB)\n`,
  );
}

const vm = await spawn({
  baseRootfs: snapshot,
  kernel,
  dtb,
  bundle: here,
  portForward: [{ hostPort: 8080, guestPort: 3000 }],
  timeoutMs: null,
});

vm.stdout.pipe(process.stdout);
vm.stderr.pipe(process.stderr);
process.on("SIGINT", () => void vm.kill());
process.on("SIGTERM", () => void vm.kill());

process.stderr.write("spawn: VM up. curl http://localhost:8080/\n");
await vm.wait();
