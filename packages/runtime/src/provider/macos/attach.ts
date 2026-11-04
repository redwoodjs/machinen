// Reconstruct a macOS handle from the registry.
//
// This is the path a second process takes after `--detached` boot. It
// rebuilds the transport from the persisted endpoint and re-derives
// capabilities from the entry, so a provider that lost a capability
// refuses instead of silently degrading.

import { ExecError, RegistryError } from "../../errors.ts";
import type { RegistryEntry } from "../../registry.ts";
import type { VmHandle } from "../../vm-handle.ts";
import { MACOS_CAPABILITIES } from "../types.ts";
import { createMacosHandle } from "./handle.ts";
import { createMacosTransport, makeTransportStateDir } from "./ssh.ts";

export interface MacosAttachOptions {
  entry: RegistryEntry;
  /** SSH identity file. Not persisted, so the caller supplies it. */
  identityFile?: string;
  /** Guest user name. Defaults to the user in the persisted endpoint. */
  user?: string;
}

export async function attachMacosGuest(opts: MacosAttachOptions): Promise<VmHandle> {
  const entry = opts.entry;
  const endpoint = parseEndpoint(entry.socketPath);
  if (!endpoint) {
    throw new RegistryError(
      "REGISTRY_VM_NOT_FOUND",
      `macOS registry entry ${entry.pid} has no usable SSH endpoint at ${entry.socketPath}.`,
    );
  }
  const identityFile = opts.identityFile ?? process.env.MACHINEN_MACOS_SSH_KEY;
  if (!identityFile) {
    throw new ExecError(
      "PROVIDER_TRANSPORT_FAILED",
      "attach to a macOS guest needs an SSH identity file. " +
        "Pass one explicitly or set MACHINEN_MACOS_SSH_KEY. " +
        "Keys are never stored in the registry.",
    );
  }
  const transport = createMacosTransport({
    ssh: {
      user: opts.user ?? endpoint.user,
      identityFile,
      port: endpoint.port,
      host: endpoint.host,
    },
    host: endpoint.host,
    stateDir: makeTransportStateDir(),
  });
  return createMacosHandle({
    pid: entry.pid,
    name: entry.name,
    transport,
    capabilities: entry.capabilities ?? MACOS_CAPABILITIES,
    wait: () => waitForPidExit(entry.pid),
    kill: () => stopAttachedGuest(entry.pid, transport),
  });
}

interface Endpoint {
  user: string;
  host: string;
  port: number;
}

function parseEndpoint(socketPath: string): Endpoint | undefined {
  const at = socketPath.indexOf("@");
  const colon = socketPath.lastIndexOf(":");
  if (at <= 0 || colon <= at) {
    return undefined;
  }
  const user = socketPath.slice(0, at);
  const host = socketPath.slice(at + 1, colon);
  const port = Number(socketPath.slice(colon + 1));
  if (!user || !host || !Number.isInteger(port)) {
    return undefined;
  }
  return { user, host, port };
}

async function waitForPidExit(
  pid: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  while (isAlive(pid)) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref?.();
    });
  }
  return { code: null, signal: null };
}

async function stopAttachedGuest(
  pid: number,
  transport: ReturnType<typeof createMacosTransport>,
): Promise<void> {
  try {
    await transport.exec("sudo -n shutdown -h now || true", { execTimeoutMs: 15_000 });
  } catch {
    // Fall through to signaling the runner.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref?.();
    });
  }
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
