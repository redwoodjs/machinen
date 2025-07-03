import fs from "node:fs";
import path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { execa } from "execa";

const PROJECT_PATH: string = process.cwd();

// Define the FileInfo interface
interface FileInfo {
  path: string;
  name: string;
  type: "file" | "directory";
}

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Routes

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// File system routes group
const fsRoutes = new Hono();

fsRoutes.get("/list", (c) => {
  // Get query parameters
  const pathname = c.req.query("pathname");
  if (!pathname) {
    return c.json(
      {
        error: "Bad Request",
        message: "pathname is required",
      },
      400
    );
  }

  let absPath = path.join(PROJECT_PATH, pathname);
  if (!fs.statSync(absPath).isDirectory()) {
    // pop off the filename part of the absPath
    absPath = path.dirname(absPath);
  }

  const files = fs.readdirSync(absPath, {
    withFileTypes: true,
  });

  const fileList: FileInfo[] = files.map((file: fs.Dirent): FileInfo => {
    return {
      path:
        "/editor" +
        path.join(file.parentPath || "", file.name).slice(PROJECT_PATH.length),
      name: file.name,
      type: file.isDirectory() ? "directory" : "file",
    };
  });
  return c.json(fileList);
});

fsRoutes.get("/stat", (c) => {
  const pathname = c.req.query("pathname") as string;
  const stat = fs.statSync(path.join(PROJECT_PATH, pathname));
  return c.json({ type: stat.isDirectory() ? "directory" : "file" });
});

fsRoutes.get("/read", (c) => {
  const pathname = c.req.query("pathname") as string;
  const content = fs.readFileSync(path.join(PROJECT_PATH, pathname), "utf8");
  return c.json({ content });
});

// write
fsRoutes.post("/write", async (c) => {
  const pathname = c.req.query("pathname") as string;
  const body = await c.req.parseBody();
  fs.writeFileSync(path.join(PROJECT_PATH, pathname), body.content as string);
  return c.json({ message: "File written successfully" });
});

// delete
// fsRoutes.delete("/delete", (c) => {
//   // TODO.
// });

app.route("/fs", fsRoutes);

// then we'll create a route for running commands.
const execRoutes = new Hono();
execRoutes.post("/", async (c) => {
  const json = await c.req.json();

  console.log(json);

  const { command, args = [], cwd = PROJECT_PATH } = json;

  if (!command) {
    return c.json(
      {
        error: "Bad Request",
        message: "command is required",
      },
      400
    );
  }

  try {
    const subprocess = execa(command, args, {
      cwd,
      stdio: "pipe",
    });

    // Create a readable stream that combines stdout and stderr
    const stream = new ReadableStream({
      start(controller) {
        // Handle stdout
        subprocess.stdout?.on("data", (chunk: Buffer) => {
          console.log("stdout: ", chunk);
          controller.enqueue(new TextEncoder().encode(`stdout: ${chunk}`));
        });

        // Handle stderr
        subprocess.stderr?.on("data", (chunk: Buffer) => {
          console.log("stderr: ", chunk);
          controller.enqueue(new TextEncoder().encode(`stderr: ${chunk}`));
        });

        // Handle process completion
        subprocess.on("close", (code: number | null) => {
          console.log("close: ", code);
          controller.enqueue(
            new TextEncoder().encode(`\nProcess exited with code: ${code}`)
          );
          controller.close();
        });

        // Handle process errors
        subprocess.on("error", (error: Error) => {
          console.log("error: ", error);
          controller.enqueue(
            new TextEncoder().encode(`Error: ${error.message}`)
          );
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.log("error: ", error);
    return c.json(
      {
        error: "Internal Server Error",
        message: `Failed to execute command: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      500
    );
  }
});

app.route("/exec", execRoutes);

// Error handling
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: "The requested resource was not found",
    },
    404
  );
});

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: "Something went wrong on the server",
    },
    500
  );
});

// Start the server
const port = 8911;
console.log(`🚀 Hono server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
