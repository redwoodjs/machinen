import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";

export default defineConfig({
  plugins: [redwood()],
  base: "/preview",
  server: {
    port: 8910,
    allowedHosts: true,
    proxy: {
      "/files": {
        target: "http://localhost:8911/files",
        changeOrigin: true,
      },
    },
  },
});
