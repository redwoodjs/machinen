// Host-side CRIU page-server runner — #266 step 2.
//
// We ship a small Zig binary (`packages/microvm/src/page-server.zig`)
// that reads CRIU `pages-*.img` content from a snapshot bundle's `img/`
// directory and serves it over TCP to a connecting `criu lazy-pages
// --page-server` client running in the guest.
//
// Why a TS module: spawning + lifecycle management belongs alongside
// the rest of the runtime (registry, gvproxy teardown, etc.). The Zig
// binary is the protocol surface; this file is the wrapper.
//
// Wiring:
//   - `restore()` / `vm.fork()` call `spawnPageServer({ imgDir })` to
//     get a `{ port, stop }` pair.
//   - The port is plumbed into the guest via `MACHINEN_RESTORE_PAGE_SERVER`.
//     Guest connects to `192.168.127.254:<port>` (gvproxy's default
//     `NAT[HostIP] = 127.0.0.1` mapping), so we bind on host loopback
//     and gvproxy translates the destination on the way in.
//   - The host process is teed to the VMM child's `exit` event so the
//     page-server doesn't outlive the restored VM.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform } from "node:os";
import { resolve } from "node:path";
import debugLib from "debug";
import { SnapshotError } from "./errors.ts";

const debug = debugLib("machinen:page-server");
const require_ = createRequire(import.meta.url);

// gvproxy's default NAT entry maps `HostIP` (192.168.127.254 on the
// default subnet) to host's `127.0.0.1`. We bind the page-server on
// loopback and let gvproxy do the address translation — no extra
// `--nat` config needed because containers/gvisor-tap-vsock seeds
// the mapping out of the box (cmd/gvproxy/config.go in main).
//
// If the project ever bumps gvproxy and the default changes, this
// constant moves; everything else stays.
export const HOST_GATEWAY_IP_FROM_GUEST = "192.168.127.254";

export interface SpawnPageServerOptions {
  /**
   * Directory of CRIU image files (the `img/` subdirectory of a
   * `vm.snapshot()` bundle). Must contain at least one `pagemap-*.img`
   * + matching `pages-*.img`.
   */
  imgDir: string;
  /**
   * Override the `machinen-page-server` binary path. Defaults to the
   * binary shipped in the `@machinen/vmm-<arch>-<os>` package.
   */
  binary?: string;
  /**
   * Override the bind address. Default `127.0.0.1`. Gvproxy NATs
   * `HOST_GATEWAY_IP_FROM_GUEST` here, so callers should leave this
   * alone unless they have a specific reason.
   */
  hostAddr?: string;
}

export interface PageServerHandle {
  /** TCP port the server is listening on (host-side). */
  port: number;
  /** `<gateway-ip>:<port>` string ready for `MACHINEN_RESTORE_PAGE_SERVER`. */
  guestEndpoint: string;
  /** Stop the server. Idempotent. */
  stop(): void;
  /** The spawned child, exposed for caller-side wiring (e.g. attaching to a VMM exit hook). */
  child: ChildProcessWithoutNullStreams;
}

/**
 * Locate the `machinen-page-server` binary. Mirrors the resolveVmmBinary
 * lookup order:
 *   1. `MACHINEN_PAGE_SERVER` env var (dev-mode override).
 *   2. The `pageServer` export of `@machinen/vmm-<arch>-<os>`.
 */
export function resolvePageServerBinary(): string {
  const envOverride = process.env.MACHINEN_PAGE_SERVER;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      throw new SnapshotError(
        "PAGE_SERVER_BINARY_MISSING",
        `MACHINEN_PAGE_SERVER is set to ${envOverride}, but that file does not exist.`,
      );
    }
    return abs;
  }

  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/vmm-${key}`;
  try {
    const mod = require_(pkgName) as { pageServer?: string };
    if (!mod.pageServer || !existsSync(mod.pageServer)) {
      throw new SnapshotError(
        "PAGE_SERVER_BINARY_MISSING",
        `${pkgName} is installed but its page-server binary is missing at ` +
          `${mod.pageServer ?? "<unset>"}. ` +
          `Set MACHINEN_PAGE_SERVER to a built copy or upgrade the package.`,
      );
    }
    return mod.pageServer;
  } catch (err) {
    if (err instanceof SnapshotError) {
      throw err;
    }
    throw new SnapshotError(
      "PAGE_SERVER_BINARY_MISSING",
      `No machinen-page-server binary found for ${key}.\n` +
        `  Expected package: ${pkgName} (with a 'pageServer' export)\n` +
        `  Override with MACHINEN_PAGE_SERVER=/path/to/machinen-page-server.`,
      { cause: err },
    );
  }
}

/**
 * Pick a free TCP port by binding to 0 on the chosen address, reading
 * the assigned port, and closing. There's a tiny race window between
 * `close()` and the page-server's `bind()` where another process could
 * grab the same port; we accept it because the alternative (port-pool
 * with SO_REUSEPORT) is much more machinery for a marginal robustness
 * win and the smoke tests run sequentially.
 */
async function pickEphemeralPort(addr: string): Promise<number> {
  return await new Promise<number>((done, fail) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", fail);
    srv.listen(0, addr, () => {
      const a = srv.address();
      if (a === null || typeof a === "string") {
        fail(new Error("ephemeral port probe returned no address"));
        return;
      }
      const port = a.port;
      srv.close(() => done(port));
    });
  });
}

/**
 * Spawn the host-side CRIU page-server. The returned handle's `stop()`
 * tears the child down idempotently; callers should wire it to the
 * restored VM's exit so the page-server doesn't outlive the VM.
 *
 * Bumping the host RSS by the binary's working set isn't an issue —
 * the page-server reads pagemap-*.img into memory at startup (~MBs at
 * most for the index) and serves pages-*.img content via `pread()`,
 * which the kernel pagecaches naturally. That's the SAME bytes that
 * would otherwise inflate the workload's anon mappings, but they sit
 * in pagecache where the host can reclaim them under pressure.
 */
export async function spawnPageServer(opts: SpawnPageServerOptions): Promise<PageServerHandle> {
  const binary = opts.binary ?? resolvePageServerBinary();
  const hostAddr = opts.hostAddr ?? "127.0.0.1";
  const port = await pickEphemeralPort(hostAddr);
  debug("spawn binary=%s imgDir=%s addr=%s port=%d", binary, opts.imgDir, hostAddr, port);

  const child = spawn(binary, ["-D", opts.imgDir, "--addr", hostAddr, "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  // Don't pin the event loop — caller stops us explicitly via the
  // VMM-exit hook. If the runtime exits before the restored VM, the
  // VM keeps running and the page-server (orphaned to PID 1) takes
  // over — same lifecycle gvproxy gets when detach is in play.
  child.unref();

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) {
      debug("stop pid=%d", child.pid ?? -1);
      child.kill("SIGTERM");
    }
  };

  // Surface page-server stderr at debug level. Failures to find pages
  // (e.g. a misformed bundle) print warnings on stderr — useful when a
  // snapshot was produced by a buggy CRIU and the lazy-pages client
  // mysteriously dies after a few faults.
  child.stderr.on("data", (chunk: Buffer) => {
    debug("stderr: %s", chunk.toString("utf8").trimEnd());
  });
  child.stdout.on("data", (chunk: Buffer) => {
    debug("stdout: %s", chunk.toString("utf8").trimEnd());
  });

  // The Zig binary's main loop runs the loadBundle() up front and only
  // calls listen() once that succeeds. Wait briefly for the child to
  // get past startup before returning so callers can rely on the port
  // being live by the time `MACHINEN_RESTORE_PAGE_SERVER` reaches the
  // guest. If the binary exits early, surface the failure with stderr
  // captured as the cause hint.
  let earlyStderr = "";
  const earlyExit = new Promise<never>((_, fail) => {
    child.once("exit", (code, signal) => {
      if (stopped) {
        return;
      }
      fail(
        new SnapshotError(
          "PAGE_SERVER_FAILED",
          `machinen-page-server exited before serving (code=${code} signal=${signal}). ` +
            (earlyStderr ? `stderr:\n${earlyStderr.slice(-2000)}` : "no stderr captured"),
        ),
      );
    });
  });
  child.stderr.once("data", (c: Buffer) => {
    earlyStderr += c.toString("utf8");
  });

  // No on-the-wire health check — the binary doesn't print a "ready"
  // marker. We give it a brief wall-clock head start for the listen
  // syscall to complete; under load the actual TCP connect from the
  // guest is retry-tolerant via gvproxy's buffer.
  await Promise.race([
    earlyExit,
    new Promise<void>((resolve_) => setTimeout(resolve_, 250).unref()),
  ]).catch((err) => {
    stop();
    throw err;
  });

  return {
    port,
    guestEndpoint: `${HOST_GATEWAY_IP_FROM_GUEST}:${port}`,
    stop,
    child,
  };
}
