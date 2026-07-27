import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: ["@machinen/desktop-sdk"],
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
});
