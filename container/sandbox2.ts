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

// Store active subprocesses for cancellation
const activeProcesses = new Map<string, any>();

// then we'll create a route for running commands.
const execRoutes = new Hono();

execRoutes.post("/exec", async (c) => {
  const json = await c.req.json();

  let { command, args = [], cwd = PROJECT_PATH, outputFile } = json;

  // If command contains spaces and no args are provided, parse the command
  if (command.includes(" ")) {
    [command, ...args] = command.split(" ");
  }

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

    // Use the actual process PID
    const processId =
      subprocess.pid?.toString() ||
      `process_unknown_${Date.now()}_${Math.random().toString(36)}`;

    // Store the subprocess for cancellation
    activeProcesses.set(processId, subprocess);

    // Create a generic log file for this process
    const logDir = path.join(PROJECT_PATH, ".wrangler", "tmp");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFileName = `exec_${processId}.log`;
    const logFilePath = path.join(logDir, logFileName);
    const logStream = fs.createWriteStream(logFilePath);

    // Create a readable stream that combines stdout and stderr
    const stream = new ReadableStream({
      start(controller) {
        let isClosed = false;
        let hasError = false;

        const safeEnqueue = (data: string) => {
          if (!isClosed && !hasError) {
            try {
              controller.enqueue(new TextEncoder().encode(data));
            } catch (error) {
              console.log("Failed to enqueue data:", error);
              isClosed = true;
            }
          }
        };

        const safeClose = () => {
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (error) {
              console.log("Failed to close controller:", error);
            }
          }
        };

        const safeError = (error: Error) => {
          if (!isClosed && !hasError) {
            hasError = true;
            try {
              controller.error(error);
            } catch (err) {
              console.log("Failed to error controller:", err);
              safeClose();
            }
          }
        };

        // Handle stdout
        subprocess.stdout?.on("data", (chunk: Buffer) => {
          console.log("stdout: ", chunk);
          const output = `stdout: ${chunk}`;
          safeEnqueue(output);
          logStream.write(output);
        });

        // Handle stderr
        subprocess.stderr?.on("data", (chunk: Buffer) => {
          console.log("stderr: ", chunk);
          const output = `stderr: ${chunk}`;
          safeEnqueue(output);
          logStream.write(output);
        });

        // Handle process completion
        subprocess.on("close", (code: number | null) => {
          console.log("close: ", code);
          const exitMessage = `\nProcess exited with code: ${code}`;

          if (!hasError) {
            safeEnqueue(exitMessage);
            logStream.write(exitMessage);
          }

          logStream.end();
          safeClose();
          // Clean up the process from active processes
          activeProcesses.delete(processId);
        });

        // Handle process errors
        subprocess.on("error", (error: Error) => {
          console.log("error: ", error);
          const errorMessage = `\nProcess error: ${error.message}\n`;
          logStream.write(errorMessage);
          logStream.end();
          safeError(error);
          // Clean up the process from active processes
          activeProcesses.delete(processId);
        });

        // Handle stream cancellation
        return () => {
          console.log("Stream cancelled, killing subprocess");
          const cancelMessage = `\nProcess cancelled by user\n`;
          logStream.write(cancelMessage);
          logStream.end();
          subprocess.kill();
          activeProcesses.delete(processId);
        };
      },
    });

    return new Response(processId, {
      headers: {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
        "X-Process-ID": processId,
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

// Add a route to cancel a running process
execRoutes.delete("/delete", async (c) => {
  const json = await c.req.json();
  const { processId } = json;

  if (!processId) {
    return c.json(
      {
        error: "Bad Request",
        message: "processId is required in request body",
      },
      400
    );
  }

  const subprocess = activeProcesses.get(processId);

  if (!subprocess) {
    return c.json(
      {
        error: "Not Found",
        message: "Process not found or already completed",
      },
      404
    );
  }

  try {
    // Kill the subprocess
    subprocess.kill();
    activeProcesses.delete(processId);

    return c.json({
      message: "Process cancelled successfully",
      processId,
    });
  } catch (error) {
    console.log("Error cancelling process:", error);
    return c.json(
      {
        error: "Internal Server Error",
        message: `Failed to cancel process: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      500
    );
  }
});

// Add a route to list log files
execRoutes.get("/output", (c) => {
  const processId = c.req.query("processId");

  if (!processId) {
    return c.json(
      { error: "Bad Request", message: "processId is required" },
      400
    );
  }

  const logDir = path.join(PROJECT_PATH, ".wrangler", "tmp");
  const logFileName = `exec_${processId}.log`;
  const logFilePath = path.join(logDir, logFileName);

  if (!fs.existsSync(logFilePath)) {
    return c.json(
      { error: "Not Found", message: `Log file not found: ${logFilePath}` },
      404
    );
  }

  const logStream = fs.createReadStream(logFilePath);
  // convert fs stream to a readable stream
  const readableStream = new ReadableStream({
    start(controller) {
      logStream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });

      logStream.on("end", () => {
        controller.close();
      });

      logStream.on("error", (error) => {
        controller.error(error);
      });
    },
  });

  return new Response(readableStream, {
    headers: { "Content-Type": "text/plain", "Transfer-Encoding": "chunked" },
  });
});

app.route("/tty", execRoutes);

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
