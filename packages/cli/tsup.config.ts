import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/machinen.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  target: "node22",
});
