import { createServer, type Server, type Socket } from "node:net";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MachinenClient } from "../machinen-client.js";

interface RequestMessage {
  id: string;
  op: string;
  params: Record<string, unknown>;
}

const socketPath = join(tmpdir(), `machinen-mcp-test-${process.pid}.sock`);

let server: Server;
let sockets: Socket[];
let operations: string[];
let lastRequest: RequestMessage | undefined;

function write(socket: Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value)}\n`);
}

function handleRequest(socket: Socket, request: RequestMessage): void {
  operations.push(request.op);
  lastRequest = request;
  let result: unknown = {};
  if (request.op === "system.hello") {
    result = { protocol: 1 };
  } else if (request.op === "events.subscribe") {
    result = {
      subscriptionId: "sub_test",
      snapshot: {
        workspaces: [],
        tiles: [],
        terminals: [
          {
            id: "term_test",
            processState: "running",
          },
        ],
        ui: { level: "overview" },
      },
    };
  } else if (request.op === "workspace.create") {
    result = { id: "ws_test", name: request.params.name };
  } else if (request.op === "terminal.get") {
    result = { id: "term_test", processState: "running" };
  } else if (request.op === "terminal.send") {
    result = { terminalId: "term_test", bytesWritten: 6 };
    setTimeout(() => {
      write(socket, {
        v: 1,
        type: "event",
        seq: 1,
        event: "terminal.output",
        data: {
          terminalId: "term_test",
          dataBase64: Buffer.from("ready\n").toString("base64"),
        },
      });
    }, 5);
  }
  write(socket, {
    v: 1,
    type: "response",
    id: request.id,
    ok: true,
    result,
  });
}

beforeEach(async () => {
  process.env.MACHINEN_MCP_NO_LAUNCH = "1";
  await rm(socketPath, { force: true });
  sockets = [];
  operations = [];
  lastRequest = undefined;
  server = createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) {
          handleRequest(socket, JSON.parse(line) as RequestMessage);
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
});

afterEach(async () => {
  delete process.env.MACHINEN_MCP_NO_LAUNCH;
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(socketPath, { force: true });
});

describe("MachinenClient", () => {
  it("negotiates, subscribes, and forwards API requests", async () => {
    const client = new MachinenClient(socketPath);
    const workspace = await client.request(
      "workspace.create",
      { name: "website" },
      "workspace-website",
    );

    expect(workspace).toEqual({ id: "ws_test", name: "website" });
    expect(operations).toEqual(["system.hello", "events.subscribe", "workspace.create"]);
    expect(lastRequest?.params).toEqual({ name: "website" });
    client.close();
  });

  it("buffers PTY output and waits for literal text", async () => {
    const client = new MachinenClient(socketPath);
    await client.request("terminal.send", {
      terminalId: "term_test",
      text: "start",
      appendNewline: true,
    });
    const result = await client.waitForTerminal({
      terminalId: "term_test",
      contains: "ready",
      timeoutMilliseconds: 1_000,
    });

    expect(result.matched).toBe(true);
    expect((result.output as { text: string }).text).toContain("ready");
    const output = client.readTerminalOutput("term_test");
    expect(output.endCursor).toBe(6);
    expect(output.text).toBe("ready\n");
    client.close();
  });
});
