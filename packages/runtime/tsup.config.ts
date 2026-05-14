import { defineConfig } from "tsup";

export default defineConfig({
  // The live-mount server moved to a Zig binary (#329) shipped inside
  // `@machinen/native-arm64-{darwin,linux}`. The TS-side runtime only
  // resolves and spawns it; nothing here builds a JS server bin.
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    // Ship .js.map files for stack-trace resolution but strip
    // `sourcesContent` so the original TypeScript isn't embedded
    // in the published package.
    options.sourcesContent = false;
  },
  external: ["@homebridge/node-pty-prebuilt-multiarch"],
});
