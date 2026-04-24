// gvproxy subprocess manager for virtio-net.
//
// gvproxy (containers/gvisor-tap-vsock) is a Go binary that runs a
// user-mode TCP/IP stack and speaks the qemu-netdev wire protocol
// (4-byte BE length prefix + ethernet frame) over a Unix socket. We
// spawn it next to the VMM so the VMM can dial the socket and get
// outbound networking without needing kernel privileges.
//
// Resolution order for the gvproxy binary:
//   1. $MACHINEN_GVPROXY — explicit override, for dev and CI.
//   2. Sibling of the VMM binary (our vmm-<arch>-<os> packages bundle
//      gvproxy alongside the `microvm` binary).
//   3. `gvproxy` on PATH — for users who already have it installed
//      (Podman, manual download, etc.).
//   4. `null` — no gvproxy found. The VMM falls back to "no network"
//      and the rest of the process runs fine.

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { delimiter as pathSep, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import debugLib from "debug";

const debug = debugLib("machinen:gvproxy");

let warnedMissing = false;

/**
 * Find the gvproxy binary using the documented lookup order. Returns
 * an absolute path, or `null` if gvproxy isn't available on this host.
 */
export function resolveGvproxyBinary(vmmBinary: string): string | null {
  const envOverride = process.env.MACHINEN_GVPROXY;
  if (envOverride) {
    if (existsSync(envOverride)) {
      debug("resolved via MACHINEN_GVPROXY=%s", envOverride);
      return envOverride;
    }
    // Explicit override that points at nothing is a user mistake —
    // surface it rather than silently falling through.
    throw new Error(`MACHINEN_GVPROXY=${envOverride} is set but that file does not exist.`);
  }

  const sibling = join(dirname(vmmBinary), "gvproxy");
  if (existsSync(sibling)) {
    debug("resolved via VMM sibling=%s", sibling);
    return sibling;
  }

  const pathDirs = (process.env.PATH ?? "").split(pathSep);
  for (const dir of pathDirs) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, "gvproxy");
    if (existsSync(candidate)) {
      debug("resolved via PATH=%s", candidate);
      return candidate;
    }
  }
  debug("not found (env, sibling, PATH all missed)");
  return null;
}

export interface GvproxyHandle {
  /** Absolute path to the qemu-netdev Unix socket. */
  socketPath: string;
  /**
   * Absolute path to gvproxy's control API unix socket. Used by
   * `exposePort()` to install host->guest TCP forwards via
   * `/services/forwarder/expose`.
   */
  controlSocketPath: string;
  /** The spawned gvproxy child. */
  child: ChildProcess;
  /** Kill gvproxy and clean up the socket + temp dir. Idempotent. */
  stop: () => void;
}

/**
 * Spawn gvproxy and block until its qemu-netdev socket is ready.
 * Throws if the socket doesn't appear within `timeoutMs`.
 */
export async function spawnGvproxy(
  binary: string,
  opts: { timeoutMs?: number } = {},
): Promise<GvproxyHandle> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  // Short, unique dir so the socket path stays well under the ~104
  // byte sun_path limit on macOS even if TMPDIR is long.
  const dir = mkdtempSync(join(tmpdir(), "mgv-"));
  const socketPath = join(dir, "qemu.sock");
  const controlSocketPath = join(dir, "net.sock");

  // Two listeners: `-listen-qemu` is the qemu-netdev protocol socket
  // the VMM dials for frames; `-listen` is gvproxy's HTTP control API,
  // used by `exposePort()` to install host->guest port forwards. Both
  // unix:// URLs, both auto-created by gvproxy. No vsock listener.
  const spawnT0 = Date.now();
  const child = nodeSpawn(
    binary,
    ["-listen-qemu", `unix://${socketPath}`, "-listen", `unix://${controlSocketPath}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  debug("spawned pid=%d qemu=%s ctrl=%s", child.pid ?? -1, socketPath, controlSocketPath);

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) {
      debug("stop() killing pid=%d", child.pid ?? -1);
      child.kill("SIGTERM");
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  };

  // Fail fast if gvproxy exited before we saw the socket — saves us
  // from waiting the full timeout on a typo or permissions problem.
  const earlyExit = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      if (stopped) {
        return;
      }
      reject(
        new Error(
          `gvproxy exited before its socket was ready (code=${code}, signal=${signal}). ` +
            `Binary: ${binary}`,
        ),
      );
    });
  });

  const socketReady = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(socketPath)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `gvproxy did not create ${socketPath} within ${timeoutMs}ms. ` + `Binary: ${binary}`,
    );
  })();

  try {
    await Promise.race([socketReady, earlyExit]);
  } catch (err) {
    debug("startup failed err=%s", err instanceof Error ? err.message : String(err));
    stop();
    throw err;
  }
  debug("ready elapsed=%dms", Date.now() - spawnT0);

  return { socketPath, controlSocketPath, child, stop };
}

/**
 * Install a host -> guest TCP port forward via gvproxy's control API.
 *
 * POSTs to `/services/forwarder/expose` with `{local, remote}` where:
 *   - `local`  is `<hostAddr>:<hostPort>` on the host side of gvproxy
 *   - `remote` is `<guestAddr>:<guestPort>` inside gvproxy's user-mode
 *     network (the guest sits at 192.168.127.2 by default).
 *
 * gvproxy accepts host-side connections as soon as the forward is
 * installed and buffers them until the guest's listener is ready, so
 * calling this before the VMM boots is fine.
 */
export async function exposePort(
  controlSocketPath: string,
  opts: {
    hostPort: number;
    guestPort: number;
    /** Host bind address. Default `127.0.0.1` (loopback-only). */
    hostAddr?: string;
    /** Guest IP inside gvproxy's user-mode NAT. Default `192.168.127.2`. */
    guestAddr?: string;
  },
): Promise<void> {
  const hostAddr = opts.hostAddr ?? "127.0.0.1";
  const guestAddr = opts.guestAddr ?? "192.168.127.2";
  const body = JSON.stringify({
    local: `${hostAddr}:${opts.hostPort}`,
    remote: `${guestAddr}:${opts.guestPort}`,
  });
  debug("expose %s:%d -> %s:%d", hostAddr, opts.hostPort, guestAddr, opts.guestPort);

  await new Promise<void>((done, fail) => {
    const req = httpRequest(
      {
        socketPath: controlSocketPath,
        method: "POST",
        path: "/services/forwarder/expose",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            done();
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8").trim();
          fail(
            new Error(
              `gvproxy expose failed (${status}) for ${hostAddr}:${opts.hostPort} -> ${guestAddr}:${opts.guestPort}: ${text || "<empty body>"}`,
            ),
          );
        });
      },
    );
    req.once("error", fail);
    req.write(body);
    req.end();
  });
}

/**
 * One-time stderr warning the first time we try to enable networking
 * on a host that doesn't have gvproxy. Kept terse so it doesn't swamp
 * the console; the VMM's fallback path still runs.
 */
export function warnGvproxyMissing(): void {
  if (warnedMissing) {
    return;
  }
  warnedMissing = true;
  process.stderr.write(
    "machinen: gvproxy not found — microVM networking is disabled.\n" +
      "  Install: https://github.com/containers/gvisor-tap-vsock/releases\n" +
      "  Or point MACHINEN_GVPROXY at the binary directly.\n",
  );
}
