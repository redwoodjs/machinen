// Host-side per-boot secret injector — #48 M3.
//
// Baking ANTHROPIC_API_KEY (and any other long-lived credential) into
// the initramfs or a snapshot is a security smell and a rotation pain.
// This class pushes secrets into the running guest over the same
// vsock bridge we already use for winsize + control plane.
//
// Pairs with `packages/microvm/assets/secrets-agent.zig`, which
// binds AF_VSOCK port 1975 inside the guest, reads KEY=VALUE lines,
// and writes them to /etc/machinen.env (0600) for cc-session.sh (or
// anything else) to source.
//
// Usage:
//
//   const vm = await boot({
//     binary: VMM,
//     vmmEnv: { MACHINEN_VSOCK: "in:1975:/tmp/machinen-secrets.sock" },
//   });
//   await VsockSecrets.send("/tmp/machinen-secrets.sock", {
//     ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
//   });

import { connect as netConnect, type Socket } from "node:net";
import { SecretsError } from "./errors.ts";

export interface VsockSecretsOptions {
  /** How long to keep retrying the UDS connect. Default 10s. */
  timeoutMs?: number;
  /** Poll interval in ms while retrying. Default 250. */
  retryMs?: number;
}

export const VsockSecrets = {
  /**
   * Open the UDS the vsock bridge is listening on, push every
   * KEY=VALUE entry, close. Resolves once the write + close drain.
   *
   * Values must be single-line (no newlines). Keys must be valid
   * shell identifiers (letters/digits/underscore, no leading digit);
   * the guest agent skips entries that don't match.
   */
  async send(
    udsPath: string,
    secrets: Record<string, string>,
    opts: VsockSecretsOptions = {},
  ): Promise<void> {
    for (const [k, v] of Object.entries(secrets)) {
      if (/[\r\n]/.test(v)) {
        throw new SecretsError(
          "SECRETS_VALUE_INVALID",
          `secret ${k} contains a newline — reject at the host`,
        );
      }
    }
    const socket = await connectWithRetry(udsPath, opts);
    try {
      for (const [k, v] of Object.entries(secrets)) {
        socket.write(`${k}=${v}\n`);
      }
    } finally {
      await endSocket(socket);
    }
  },
} as const;

async function connectWithRetry(udsPath: string, opts: VsockSecretsOptions): Promise<Socket> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  const retryMs = opts.retryMs ?? 250;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(udsPath);
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  throw new SecretsError(
    "SECRETS_AGENT_UNAVAILABLE",
    `VsockSecrets.send(${udsPath}) gave up after ${opts.timeoutMs ?? 10_000}ms: ${lastErr?.message ?? "no error"}`,
    { retryable: true, cause: lastErr ?? undefined },
  );
}

function connectOnce(udsPath: string): Promise<Socket> {
  return new Promise((done, fail) => {
    const s = netConnect(udsPath);
    const onErr = (e: Error) => {
      s.removeListener("connect", onConnect);
      fail(e);
    };
    const onConnect = () => {
      s.removeListener("error", onErr);
      done(s);
    };
    s.once("error", onErr);
    s.once("connect", onConnect);
  });
}

function endSocket(s: Socket): Promise<void> {
  return new Promise((done) => {
    if (s.destroyed) {
      done();
      return;
    }
    s.once("close", () => done());
    s.end();
  });
}
