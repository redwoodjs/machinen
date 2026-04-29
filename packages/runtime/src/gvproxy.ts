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
//   3. `~/.machinen/gvproxy/<version>/gvproxy` — auto-install cache
//      populated by `ensureGvproxy()` (see below).
//   4. `gvproxy` on PATH — for users who already have it installed
//      (Podman, manual download, etc.).
//   5. `null` — no gvproxy found. Callers that only need resolution
//      can stop here; callers that can install it on demand go through
//      `ensureGvproxy()`.

import { type ChildProcess, execFile, spawn as nodeSpawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { arch as osArch, homedir, platform as osPlatform, tmpdir } from "node:os";
import { delimiter as pathSep, dirname, join } from "node:path";
import { promisify } from "node:util";
import debugLib from "debug";
import { GvproxyError } from "./errors.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "./pdeathsig.ts";

const debug = debugLib("machinen:gvproxy");

/**
 * Pinned gvproxy version — matches `scripts/install-gvproxy.sh`. Bump
 * in lockstep with that script so the release path (bundled in
 * `@machinen/vmm-*`) and the dev auto-install path stay aligned.
 */
const GVPROXY_VERSION = "v0.8.6";

let warnedMissing = false;
let installInFlight: Promise<string | null> | null = null;

/**
 * Find the gvproxy binary using the documented lookup order. Returns
 * an absolute path, or `null` if gvproxy isn't available on this host.
 */
function resolveGvproxyBinary(vmmBinary: string): string | null {
  const envOverride = process.env.MACHINEN_GVPROXY;
  if (envOverride) {
    // Sentinel values — opt out of gvproxy entirely without fabricating
    // a fake path. Used by the test harness so stub-binary boots don't
    // pay the auto-install cost.
    if (isGvproxyDisabledSentinel(envOverride)) {
      return null;
    }
    if (existsSync(envOverride)) {
      debug("resolved via MACHINEN_GVPROXY=%s", envOverride);
      return envOverride;
    }
    // Explicit override that points at nothing is a user mistake —
    // surface it rather than silently falling through.
    throw new GvproxyError(
      "GVPROXY_NOT_FOUND",
      `MACHINEN_GVPROXY=${envOverride} is set but that file does not exist.`,
    );
  }

  const sibling = join(dirname(vmmBinary), "gvproxy");
  if (existsSync(sibling)) {
    debug("resolved via VMM sibling=%s", sibling);
    return sibling;
  }

  const cached = gvproxyCachePath();
  if (existsSync(cached)) {
    return cached;
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

/**
 * Path on disk where `ensureGvproxy()` caches auto-installed binaries.
 * Versioned so a pinned-version bump re-downloads instead of silently
 * reusing a stale binary.
 */
function gvproxyCachePath(): string {
  return join(homedir(), ".machinen", "gvproxy", GVPROXY_VERSION, "gvproxy");
}

/**
 * Resolve gvproxy, and if nothing's available, auto-download it into
 * `~/.machinen/gvproxy/<version>/gvproxy` and return that path. First
 * run on a given host emits a visible "installing" line on stderr; the
 * second run is silent (sees the cached file via `resolveGvproxyBinary`).
 *
 * Returns `null` only when every lookup fails *and* the download also
 * fails (typically offline) — callers should then fall back to
 * `warnGvproxyMissing()` and continue without networking.
 *
 * Concurrent callers within the same process share a single install
 * promise so we don't race on the same temp file.
 */
export async function ensureGvproxy(vmmBinary: string): Promise<string | null> {
  // Respect the same disable-sentinel the sync resolver honors —
  // otherwise a "disabled" env would still trigger a download attempt.
  const envOverride = process.env.MACHINEN_GVPROXY;
  if (envOverride && isGvproxyDisabledSentinel(envOverride)) {
    return null;
  }
  const found = resolveGvproxyBinary(vmmBinary);
  if (found) {
    return found;
  }
  if (!installInFlight) {
    installInFlight = downloadGvproxy().catch((err) => {
      process.stderr.write(
        `machinen: auto-install of gvproxy failed (${err instanceof Error ? err.message : String(err)})\n` +
          `  Networking stays disabled for this boot. Manual install: \n` +
          `  bash scripts/install-gvproxy.sh --dest ${dirname(gvproxyCachePath())}\n`,
      );
      return null;
    });
  }
  return installInFlight;
}

async function downloadGvproxy(): Promise<string> {
  const outPath = gvproxyCachePath();
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });

  // Cross-process serialization. Multiple vitest workers (and real
  // callers that boot VMs concurrently) all hit this path on a fresh
  // host — without a lock, two processes racing on the same output
  // file produce `ETXTBSY` when one tries to exec while the other
  // still has a write fd open. The lock funnels writes through a
  // single process; the others wait for the cache file to appear.
  const lockPath = `${outPath}.lock`;
  let lockFd: number | null = null;
  try {
    lockFd = openSync(lockPath, "wx");
  } catch {
    // Someone else holds the lock. If they've already landed the
    // binary, pick it up; otherwise wait for them to finish.
    if (existsSync(outPath)) {
      return outPath;
    }
    return waitForCachedGvproxy(outPath, lockPath);
  }

  try {
    // Re-check after claiming the lock: a racer may have finished
    // between our resolve attempt and the lock acquisition.
    if (existsSync(outPath)) {
      return outPath;
    }

    const assetName = gvproxyAssetName();
    const url = `https://github.com/containers/gvisor-tap-vsock/releases/download/${GVPROXY_VERSION}/${assetName}`;

    // Visible: one line before the fetch, one after. Same cadence the
    // base-asset auto-fetch uses in `@machinen/cli`.
    process.stderr.write(
      `machinen: installing gvproxy ${GVPROXY_VERSION} (${assetName}) → ${outPath}\n`,
    );

    const tmp = `${outPath}.partial.${process.pid}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      throw new GvproxyError(
        "GVPROXY_INSTALL_FAILED",
        `fetch ${url} failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = Buffer.from(await res.arrayBuffer());
    // writeFile + explicit fsync + close before rename: createWriteStream
    // doesn't guarantee the kernel has dropped the write fd by the time
    // the returned promise resolves, and a still-open write fd is what
    // triggers `ETXTBSY` when another process exec()s the renamed file.
    await writeFile(tmp, body);
    const tmpFd = openSync(tmp, "r+");
    try {
      fsyncSync(tmpFd);
    } finally {
      closeSync(tmpFd);
    }
    chmodSync(tmp, 0o755);
    renameSync(tmp, outPath);

    process.stderr.write(`machinen: gvproxy installed at ${outPath}\n`);
    return outPath;
  } finally {
    if (lockFd !== null) {
      try {
        closeSync(lockFd);
      } catch {}
    }
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

/**
 * Poll until another process finishes downloading gvproxy. Bounded so
 * a stuck peer doesn't wedge the caller forever.
 */
async function waitForCachedGvproxy(
  outPath: string,
  lockPath: string,
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(outPath)) {
      return outPath;
    }
    if (!existsSync(lockPath)) {
      // Lock cleared but binary still missing — the owner failed.
      // Retry from scratch so we don't spin on stale state.
      return downloadGvproxy();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new GvproxyError(
    "GVPROXY_INSTALL_FAILED",
    `timed out waiting ${timeoutMs}ms for another process to finish downloading gvproxy to ${outPath}`,
  );
}

/**
 * Spawn a process with retry on `ETXTBSY`. Linux fires that errno when
 * a freshly-written binary is exec'd while any peer still holds an
 * open write fd — typical for multi-worker test runs where the
 * auto-installer just landed the binary. Retries briefly until the fd
 * drains. Handles both the sync-throw and the async-`error`-event
 * shapes Node's `spawn()` uses on different platforms.
 */
async function spawnWithEtxtbsyRetry(
  binary: string,
  args: string[],
  attempts = 20,
): Promise<ChildProcess> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const child = nodeSpawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      const earlyErr = await new Promise<Error | null>((resolve) => {
        const onError = (err: Error) => {
          child.removeListener("spawn", onSpawn);
          resolve(err);
        };
        const onSpawn = () => {
          child.removeListener("error", onError);
          resolve(null);
        };
        child.once("error", onError);
        child.once("spawn", onSpawn);
      });
      if (!earlyErr) {
        return child;
      }
      lastErr = earlyErr;
      if ((earlyErr as NodeJS.ErrnoException).code !== "ETXTBSY") {
        throw earlyErr;
      }
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== "ETXTBSY") {
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new GvproxyError(
        "GVPROXY_SPAWN_FAILED",
        `spawn ${binary}: ETXTBSY after ${attempts} retries`,
      );
}

/**
 * Try to bind a TCP listener at `host:port` and immediately close it.
 * Returns `null` on success, or the OS errno code (typically
 * `"EADDRINUSE"`) on failure. Used by `boot()` as a pre-flight probe
 * for portForward host ports — gvproxy's HTTP control API surfaces
 * `address already in use` as an opaque 500, so we want to fail fast
 * with a useful error before we even spawn it.
 *
 * The probe binds and closes; the small race between close and
 * gvproxy's subsequent bind is the same one `pickEphemeralPort` lives
 * with and has not been observed to bite in practice.
 */
export async function probeHostPortFree(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    const onError = (err: NodeJS.ErrnoException) => {
      resolve(err.code ?? "EUNKNOWN");
    };
    srv.once("error", onError);
    srv.listen({ port, host }, () => {
      srv.removeListener("error", onError);
      srv.close(() => resolve(null));
    });
  });
}

const execFileAsync = promisify(execFile);

/**
 * Best-effort identification of which process is holding a TCP port.
 * Shells out to `lsof -nP -iTCP:<port> -sTCP:LISTEN`, parses the first
 * LISTEN line, then resolves the holder's full command via
 * `ps -p <pid> -o command=` to spot machinen-owned orphans (gvproxy
 * cached under `~/.machinen/`, or a stray `microvm`).
 *
 * Returns `null` when:
 *   - `lsof` isn't on PATH (some minimal containers),
 *   - lsof times out / returns nonzero (no LISTEN holder, transient),
 *   - the output didn't parse into a recognizable line.
 *
 * The returned string is meant to be appended verbatim to a port-in-use
 * error message; format is one of:
 *   - `held by machinen-owned gvproxy (pid 1234) — try \`kill 1234\` to clear it`
 *   - `held by chrome (pid 5678)`
 */
export async function describePortHolder(port: number): Promise<string | null> {
  let stdout: string;
  try {
    const result = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      timeout: 2_000,
    });
    stdout = result.stdout;
  } catch {
    return null;
  }
  // First non-header line: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("COMMAND"));
  if (!line) {
    return null;
  }
  const fields = line.split(/\s+/);
  const cmd = fields[0];
  const pid = fields[1];
  if (!cmd || !pid || !/^\d+$/.test(pid)) {
    return null;
  }

  let fullCmd = "";
  try {
    const { stdout: psOut } = await execFileAsync("ps", ["-p", pid, "-o", "command="], {
      timeout: 1_000,
    });
    fullCmd = psOut.trim();
  } catch {
    // ps unavailable or process exited between lsof and ps — fall back
    // to the bare COMMAND from lsof.
  }

  const machinenDir = join(homedir(), ".machinen");
  const looksMachinen =
    (fullCmd && fullCmd.includes(machinenDir)) || cmd === "gvproxy" || cmd === "microvm";

  return looksMachinen
    ? `held by machinen-owned ${cmd} (pid ${pid}) — try \`kill ${pid}\` to clear it`
    : `held by ${cmd} (pid ${pid})`;
}

/**
 * Bind to 127.0.0.1:0 to let the OS pick a free TCP port, close the
 * probe socket, return the number. Good enough for gvproxy's
 * `-ssh-port` where the tiny close-to-bind race is ~never observed.
 */
async function pickEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

/**
 * Recognize the caller opt-out tokens for `MACHINEN_GVPROXY`. Set to
 * one of these when a process (typically a test) doesn't want the
 * runtime to download, discover, or spawn gvproxy at all — `boot()`
 * will fall through the warn-and-continue path.
 */
function isGvproxyDisabledSentinel(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === "disabled" || v === "off" || v === "false" || v === "0" || v === "none";
}

/**
 * Pick the upstream release asset for this host. Mirrors the mapping
 * in `scripts/install-gvproxy.sh` so the release path (bundled in
 * `@machinen/vmm-*` via CI) and the dev auto-install path stay lockstep.
 */
function gvproxyAssetName(): string {
  const platform = osPlatform();
  if (platform === "darwin") {
    return "gvproxy-darwin";
  }
  if (platform === "linux") {
    const arch = osArch();
    // gvproxy's release assets name x86_64 as `amd64`; aarch64 stays
    // `arm64`. Node reports `x64` and `arm64`.
    const gvArch = arch === "x64" ? "amd64" : arch;
    return `gvproxy-linux-${gvArch}`;
  }
  throw new GvproxyError(
    "GVPROXY_INSTALL_FAILED",
    `gvproxy: no prebuilt release asset for platform ${platform}`,
  );
}

interface GvproxyHandle {
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
  //
  // `-ssh-port` defaults to 2222, which collides the moment a second
  // gvproxy spawns on the host (multi-VM, parallel tests). None of our
  // flows use gvproxy's built-in SSH forwarder, so we pick an
  // ephemeral port per spawn — the OS hands us a free one, we close
  // the probe socket, gvproxy binds immediately after. A race window
  // of ~0 in practice; a retry could gild it further if we ever see
  // it bite.
  const sshPort = await pickEphemeralPort();
  const args = [
    "-listen-qemu",
    `unix://${socketPath}`,
    "-listen",
    `unix://${controlSocketPath}`,
    "-ssh-port",
    String(sshPort),
  ];
  const spawnT0 = Date.now();
  // Wrap through the parent-death shim so a kill -9 of the runtime
  // takes gvproxy with it instead of orphaning it to PID 1 with the
  // host port stuck. Falls through to direct spawn if the shim is
  // unavailable (no `cc` toolchain, opted-out, unsupported platform);
  // the BOOT_PORT_FORWARD_IN_USE pre-flight probe is the safety net
  // in that case. See #115.
  const pdeathsig = await ensurePdeathsig();
  const wrapped = wrapWithPdeathsig(pdeathsig, binary, args);
  // Small retry loop around exec() for `ETXTBSY`. On Linux this fires
  // briefly after a freshly-written binary gets exec'd while a peer
  // still has a write fd open — rare with the lock + fsync in
  // `downloadGvproxy`, but belt-and-suspenders for multi-process
  // test runners.
  const child = await spawnWithEtxtbsyRetry(wrapped.command, wrapped.args);
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
    throw new GvproxyError(
      "GVPROXY_NOT_FOUND",
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
          // Map gvproxy's opaque 500 to a specific code when the embedded
          // Go errno text reveals an EADDRINUSE — callers (and humans)
          // can then decide to wait, kill, or pick another port instead
          // of grepping the message. The pre-flight probe in `boot()`
          // catches most occurrences; this is the safety net for the
          // close-to-bind race window and for direct callers of
          // `exposePort` that skip the probe.
          if (/address already in use/i.test(text)) {
            // describePortHolder shells out, so resolve the message
            // before rejecting. Failures fall back to a no-hint message.
            describePortHolder(opts.hostPort)
              .catch(() => null)
              .then((holder) => {
                const hint = holder
                  ? ` (${holder})`
                  : " (set by another process — try `lsof -nP -iTCP:" + opts.hostPort + "`)";
                fail(
                  new GvproxyError(
                    "GVPROXY_PORT_IN_USE",
                    `host port ${hostAddr}:${opts.hostPort} is already in use${hint}.`,
                  ),
                );
              });
            return;
          }
          fail(
            new GvproxyError(
              "GVPROXY_EXPOSE_FAILED",
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
