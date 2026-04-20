// Push files into / pull files out of a running guest over vsock (#57).
//
// Pairs with packages/microvm/test-fixtures/file-agent.py, which binds
// AF_VSOCK on port 1976. Boot the VMM with
//   MACHINEN_VSOCK=in:1976:/tmp/machinen-files.sock
// and these two calls round-trip files through the already-present
// vsock bridge. No ext4 disk, no cpio rebuild, no reboot — live push
// and pull during a session.
//
// Protocol:
//   client -> "PUSH <abs-path>\n" then tar bytes (until EOF)
//   agent  -> untars at <abs-path>
//
//   client -> "PULL <abs-path>\n" then reads
//   agent  -> streams tar of <abs-path> then closes
//
// Both sides shell out to `tar` — Node has no built-in tar and
// dragging a JS tar library in for this would be overkill.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { PassThrough } from "node:stream";

export interface VsockFilesOptions {
  /** How long to retry the UDS connect. Default 5s. */
  timeoutMs?: number;
  retryMs?: number;
  /** Forwarded to `tar --exclude=PATTERN`. Repeat per pattern. */
  excludes?: string[];
}

export const VsockFiles = {
  /**
   * Stream `hostDir`'s contents into the guest at `guestPath`. Any
   * existing files at that path are overwritten (standard `tar -x`
   * semantics). If `guestPath` doesn't exist, the agent creates it.
   */
  async push(
    udsPath: string,
    hostDir: string,
    guestPath: string,
    opts: VsockFilesOptions = {},
  ): Promise<void> {
    if (!existsSync(hostDir)) {
      throw new Error(`push: host dir does not exist: ${hostDir}`);
    }
    const sock = await connectWithRetry(udsPath, opts);
    try {
      // Assemble header + tar output into a single PassThrough,
      // pipe that to the socket. Doing `sock.write(header);
      // tar.stdout.pipe(sock)` as two steps raced on macOS under
      // load — the header ended up interleaved with the start of
      // the tar body on the wire, corrupting the stream.
      //
      // `--format=ustar` forces the old POSIX.1-1988 format so GNU
      // tar on the guest doesn't choke on libarchive's extended
      // pax headers. COPYFILE_DISABLE=1 stops macOS bsdtar from
      // embedding `LIBARCHIVE.xattr.com.apple.provenance` attributes
      // that GNU tar reports as "This does not look like a tar archive".
      const tarArgs: string[] = ["-cf", "-", "--format=ustar"];
      for (const e of opts.excludes ?? []) {
        tarArgs.push(`--exclude=${e}`);
      }
      tarArgs.push("-C", hostDir, ".");
      const tar = spawn("tar", tarArgs, {
        stdio: ["ignore", "pipe", "inherit"],
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
      const stream = new PassThrough();
      stream.write(`PUSH ${guestPath}\n`);
      tar.stdout.pipe(stream);
      stream.pipe(sock);
      await new Promise<void>((done, fail) => {
        let tarExit: number | null = null;
        tar.on("error", fail);
        sock.on("error", fail);
        tar.on("exit", (code) => {
          tarExit = code ?? 0;
        });
        sock.on("close", () => {
          if (tarExit !== null && tarExit !== 0) {
            fail(new Error(`local tar exited with code ${tarExit}`));
          } else {
            done();
          }
        });
      });
    } finally {
      if (!sock.destroyed) {
        sock.destroy();
      }
    }
  },

  /**
   * Stream a tar of `guestPath` from the guest and untar into
   * `hostDir`. `hostDir` is created if missing.
   */
  async pull(
    udsPath: string,
    guestPath: string,
    hostDir: string,
    opts: VsockFilesOptions = {},
  ): Promise<void> {
    mkdirSync(hostDir, { recursive: true });
    const sock = await connectWithRetry(udsPath, opts);
    try {
      sock.write(`PULL ${guestPath}\n`);
      const tar = spawn("tar", ["-xf", "-", "-C", hostDir], {
        stdio: ["pipe", "inherit", "inherit"],
      });
      await pipe(sock, tar);
    } finally {
      if (!sock.destroyed) {
        sock.destroy();
      }
    }
  },
} as const;

async function connectWithRetry(udsPath: string, opts: VsockFilesOptions): Promise<Socket> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5_000);
  const retryMs = opts.retryMs ?? 200;
  let last: Error | null = null;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(udsPath);
    } catch (err) {
      last = err as Error;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  throw new Error(`VsockFiles: could not connect to ${udsPath}: ${last?.message ?? "no error"}`);
}

function connectOnce(udsPath: string): Promise<Socket> {
  return new Promise((done, fail) => {
    const s = netConnect(udsPath);
    s.once("error", fail);
    s.once("connect", () => {
      s.removeListener("error", fail);
      done(s);
    });
  });
}

function pipe(sock: Socket, tar: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((done, fail) => {
    tar.on("error", fail);
    sock.on("error", fail);
    sock.on("data", (chunk: Buffer) => tar.stdin.write(chunk));
    sock.on("end", () => tar.stdin.end());
    sock.on("close", () => tar.stdin.end());
    tar.on("exit", (code) => {
      if (code === 0) {
        done();
      } else {
        fail(new Error(`tar exited with code ${code}`));
      }
    });
  });
}
