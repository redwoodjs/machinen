import { defineConfig } from "tsup";

export default defineConfig({
  // mount-server-bin is the standalone entry the supervisor spawns as
  // a detached helper (#150 phase 3). Built alongside the library so
  // dist/mount-server-bin.js sits next to dist/index.js and can be
  // resolved via new URL("./mount-server-bin.js", import.meta.url)
  // from compiled call sites.
  entry: ["src/index.ts", "src/mount-server-bin.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@homebridge/node-pty-prebuilt-multiarch"],
});
