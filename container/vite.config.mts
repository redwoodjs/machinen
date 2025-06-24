import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";

export default defineConfig({
  plugins: [redwood()],
  server: {
    port: 8910,
    allowedHosts: true,
    // use proxy instead of worker...
    proxy: {
      "/files": {
        target: "http://localhost:8911/files",
        changeOrigin: true,
      },
    },
  },
});
