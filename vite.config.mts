import { defineConfig, Plugin, ViteDevServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { WebSocket } from "ws";

export default defineConfig({
  environments: {
    ssr: {},
  },
  plugins: [
    proxyWebSocketPlugin(),
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
    tailwindcss(),
  ],
});

function proxyWebSocketPlugin(): Plugin {
  return {
    name: "proxyWebSocketPlugin",
    enforce: "pre",
    configureServer(server: ViteDevServer) {
      // Middleware: move query params to header for all requests
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/preview/")) {
          const url = new URL(req.url, "http://localhost");
          if (url.search) {
            // Serialize all query params as a string
            const originalQuery = url.search.slice(1); // Remove '?'
            url.search = ""; // Remove all query params
            // Add as a single internal query param
            url.searchParams.set(
              "__x_internal_query",
              encodeURIComponent(originalQuery)
            );
            req.url = url.pathname + url.search;
            console.log(
              `[proxyWebSocketPlugin] (middleware) Moved query params to __x_internal_query for ${req.url}`
            );
          }
        }
        next();
      });

      // Upgrade handler: only rename sec-websocket-protocol
      if (server.httpServer) {
        server.httpServer.on("upgrade", (req, socket, head) => {
          if (req.url?.startsWith("/preview/")) {
            const protocolHeaderKey = Object.keys(req.headers).find(
              (k) => k.toLowerCase() === "sec-websocket-protocol"
            );
            if (protocolHeaderKey) {
              req.headers["x-websocket-protocol"] =
                req.headers[protocolHeaderKey];
              delete req.headers[protocolHeaderKey];
              console.log(
                `[proxyWebSocketPlugin] Renamed sec-websocket-protocol to x-websocket-protocol for ${req.url}`
              );
            }
            // Let the next handler run (e.g., Cloudflare plugin)
            return;
          }
        });
      }
    },
  };
}
