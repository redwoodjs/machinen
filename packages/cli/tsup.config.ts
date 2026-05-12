import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    // Ship .js.map files for stack-trace resolution but strip
    // `sourcesContent` so the original TypeScript isn't embedded
    // in the published package.
    options.sourcesContent = false;
  },
  banner: { js: "#!/usr/bin/env node" },
  external: ["@machinen/runtime", "@machinen/vmm-arm64-darwin", "@machinen/vmm-arm64-linux"],
});
