import { defineConfig, Plugin, ViteDevServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { spawn, ChildProcess } from "node:child_process";

export default defineConfig({
  environments: {
    ssr: {},
  },
  plugins: [
    proxyWebSocketPlugin(),
    externalProcessPlugin(),
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
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/preview/")) {
          const url = new URL(req.url, "http://localhost");
          if (url.search) {
            const originalQuery = url.search.slice(1); // Remove '?'
            url.search = ""; // Remove all query params
            url.searchParams.set(
              "__x_internal_query",
              encodeURIComponent(originalQuery)
            );
            req.url = url.pathname + url.search;
          }
        }
        next();
      });

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
            }
            return;
          }
        });
      }
    },
  };
}

function externalProcessPlugin(): Plugin {
  let childProcess: ChildProcess | null = null;

  return {
    name: "external-process",
    enforce: "pre",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__machinen/", (req, res, next) => {
        // I don't want these to be post requests;

        console.log("req.url", req.url);

        if (req.url?.startsWith("/process/start")) {
          // grab the query params
          const queryParams = new URLSearchParams(req.url.split("?")[1]);
          const command = queryParams.get("command");

          console.log("[machinen] running command", command);

          if (!command) {
            return res.end(
              JSON.stringify({
                success: false,
                error: "query param `command` is required",
              })
            );
          }

          if (childProcess) {
            childProcess.kill();
          }

          childProcess = spawn(command, {
            stdio: "pipe",
            shell: true,
          });

          childProcess.on("error", (error) => {
            console.error("error", error);
          });

          return res.end(
            JSON.stringify({ success: true, pid: childProcess.pid })
          );
        }
        next();
      });
    },
    buildStart() {
      console.log("External process plugin loaded");
    },
    buildEnd() {
      if (childProcess) {
        childProcess.kill();
        childProcess = null;
      }
    },
  };
}
