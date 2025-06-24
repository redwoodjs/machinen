import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";

export default defineConfig({
  plugins: [
    redwood(),
    //{
    //  name: "log-incoming-requests",
    //  configureServer(server) {
    //    // Log all HTTP requests
    //    server.middlewares.use((req, res, next) => {
    //      console.log(`[inner-vite] HTTP ${req.method} ${req.url}`);
    //      next();
    //    });

    //    // Log all WebSocket upgrade requests
    //    if (server.httpServer) {
    //      server.httpServer.on("upgrade", (req, socket, head) => {
    //        console.log(
    //          `[inner-vite] WS upgrade: ${req.url}`,
    //          "headers:",
    //          req.headers
    //        );
    //      });
    //    }
    //  },
    //},
  ],
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
