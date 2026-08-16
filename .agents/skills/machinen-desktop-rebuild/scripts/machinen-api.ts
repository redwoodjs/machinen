#!/usr/bin/env node
/** Call Machinen Desktop's Unix-socket API locally or over SSH. */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { getuid } from "node:process";
import { parseArgs } from "node:util";

interface Payload {
  operation: string;
  params: Record<string, unknown>;
  timeout: number;
  idempotencyKey?: string;
}

interface ResponseEnvelope {
  type?: string;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: unknown;
}

const REMOTE_CLIENT = String.raw`
const net = require("node:net");
const readline = require("node:readline");
const payload = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
const socketPath = process.env.MACHINEN_API_SOCKET || "/tmp/machinen-" + process.getuid() + "/api-v1.sock";
const socket = net.createConnection(socketPath);
socket.setTimeout(payload.timeout * 1000, () => socket.destroy(new Error("Machinen API timed out")));
const lines = readline.createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator]();
function connected() {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}
async function request(id, operation, params, idempotencyKey) {
  const message = { v: 1, type: "request", id, op: operation, params };
  if (idempotencyKey) message.idempotencyKey = idempotencyKey;
  socket.write(JSON.stringify(message) + "\n");
  while (true) {
    const next = await lines.next();
    if (next.done) throw new Error("Machinen closed the API connection");
    const response = JSON.parse(next.value);
    if (response.type === "response" && response.id === id) {
      if (!response.ok) throw new Error(JSON.stringify(response.error || {}));
      return response.result;
    }
  }
}
(async () => {
  await connected();
  await request("hello", "system.hello", {
    client: { name: "pi-machinen-skill", version: "1" },
    protocol: { min: 1, max: 1 },
  });
  const result = await request("request", payload.operation, payload.params, payload.idempotencyKey);
  console.log(JSON.stringify(result, null, 2));
  socket.end();
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  socket.destroy();
  process.exitCode = 1;
});
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function remoteNodeCommand(encoded: string): string {
  const bootstrap = String.raw`
node_path=""
for pid in $(/usr/bin/pgrep -x Machinen 2>/dev/null || true); do
  command=$(/bin/ps -p "$pid" -o command=)
  case "$command" in
    *"/Machinen.app/Contents/MacOS/Machinen"*)
      app=$(/usr/bin/dirname "$(/usr/bin/dirname "$(/usr/bin/dirname "$command")")")
      candidate="$app/Contents/Helpers/node"
      if [ -x "$candidate" ]; then node_path="$candidate"; break; fi
      ;;
  esac
done
if [ -z "$node_path" ]; then
  node_path=$(command -v node 2>/dev/null || true)
fi
if [ -z "$node_path" ]; then
  echo "Could not find Node.js on the Machinen Desktop host" >&2
  exit 127
fi
exec "$node_path" -e ${shellQuote(REMOTE_CLIENT)} ${shellQuote(encoded)}
`;
  return `/bin/sh -c ${shellQuote(bootstrap)}`;
}

async function callLocal(payload: Payload): Promise<unknown> {
  const socketPath = process.env.MACHINEN_API_SOCKET ?? `/tmp/machinen-${getuid?.()}/api-v1.sock`;
  const socket = createConnection(socketPath);
  socket.setTimeout(payload.timeout * 1_000, () => {
    socket.destroy(new Error("Machinen API timed out"));
  });
  const lines = createInterface({ input: socket, crlfDelay: Infinity })[Symbol.asyncIterator]();

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  async function request(
    id: string,
    operation: string,
    params: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const message: Record<string, unknown> = {
      v: 1,
      type: "request",
      id,
      op: operation,
      params,
    };
    if (idempotencyKey) {
      message.idempotencyKey = idempotencyKey;
    }
    socket.write(`${JSON.stringify(message)}\n`);
    while (true) {
      const next = await lines.next();
      if (next.done) {
        throw new Error("Machinen closed the API connection");
      }
      const response = JSON.parse(next.value) as ResponseEnvelope;
      if (response.type === "response" && response.id === id) {
        if (!response.ok) {
          throw new Error(JSON.stringify(response.error ?? {}));
        }
        return response.result;
      }
    }
  }

  try {
    await request("hello", "system.hello", {
      client: { name: "pi-machinen-skill", version: "1" },
      protocol: { min: 1, max: 1 },
    });
    return await request("request", payload.operation, payload.params, payload.idempotencyKey);
  } finally {
    socket.end();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      host: { type: "string", default: process.env.MACHINEN_DESKTOP_HOST ?? "air" },
      timeout: { type: "string", default: "30" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length < 1 || positionals.length > 2) {
    throw new Error(
      "usage: node scripts/machinen-api.ts [--host local|HOST] [--timeout SECONDS] [--idempotency-key KEY] OPERATION [PARAMS_JSON]",
    );
  }

  const timeout = Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Timeout must be greater than zero");
  }
  const parsed = JSON.parse(positionals[1] ?? "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Params JSON must be an object");
  }
  const payload: Payload = {
    operation: positionals[0],
    params: parsed as Record<string, unknown>,
    timeout,
  };
  if (values["idempotency-key"]) {
    payload.idempotencyKey = values["idempotency-key"];
  }

  if (values.host === "local") {
    const result = await callLocal(payload);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const completed = spawnSync(
    "/usr/bin/ssh",
    ["-o", "BatchMode=yes", "-T", values.host, remoteNodeCommand(encoded)],
    { stdio: "inherit" },
  );
  if (completed.error) {
    throw completed.error;
  }
  if (completed.status !== 0) {
    process.exitCode = completed.status ?? 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
