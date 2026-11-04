// VmHandle for a macOS guest.
//
// Implements the shared handle surface and refuses, with a typed error,
// every operation the provider does not implement. The refusal is per
// call rather than a missing property, so a caller learns the reason
// instead of hitting `undefined is not a function`.

import { PassThrough } from "node:stream";

import { ExecError } from "../../errors.ts";
import type { VsockExecPtyHandle, VsockExecPtyOptions, VsockExecResult } from "../../exec.ts";
import type { VmHandle, MemoryStats, WriteFileOptions } from "../../vm-handle.ts";
import { MACOS_CAPABILITIES, type GuestCapabilities } from "../types.ts";
import type { MacosTransport } from "./ssh.ts";

export interface MacosHandleOptions {
  pid: number;
  name?: string;
  transport: MacosTransport;
  capabilities?: GuestCapabilities;
  /** Resolves when the runner process exits. */
  wait: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Ask the runner to stop the guest, then force it. */
  kill: () => Promise<void>;
}

export function createMacosHandle(opts: MacosHandleOptions): VmHandle {
  const capabilities = opts.capabilities ?? MACOS_CAPABILITIES;
  const exec = (cmd: string, execOpts?: Parameters<MacosTransport["exec"]>[1]) =>
    opts.transport.exec(cmd, execOpts);

  return {
    pid: opts.pid,
    name: opts.name,
    // A macOS guest has no VMM console streams in this process. Empty
    // streams keep the property contract without implying data.
    stdin: inertWritable(),
    stdout: inertReadable(),
    stderr: inertReadable(),

    wait: opts.wait,
    kill: opts.kill,
    async detach() {
      // The runner outlives this process by design; nothing local to unref.
    },
    async output() {
      return "";
    },
    async errorOutput() {
      return "";
    },

    exec(cmd, execOpts) {
      return execOrThrow(exec, cmd, execOpts);
    },
    execRaw(cmd, execOpts) {
      return exec(cmd, execOpts);
    },

    execPty(_cmd: string, _ptyOpts: VsockExecPtyOptions): VsockExecPtyHandle {
      throw unsupported(
        "execPty",
        "an interactive PTY over SSH is not a Machinen persistent session. " +
          "Use `machinen exec --tty` for an SSH PTY, or wait for the Darwin session service.",
      );
    },

    async writeFile(guestPath, contents, writeOpts) {
      if (!capabilities.files) {
        throw unsupported("writeFile", "this provider has no file transport.");
      }
      await writeFileOverSsh(exec, guestPath, contents, writeOpts);
    },

    async memoryStats(): Promise<MemoryStats> {
      throw unsupported(
        "memoryStats",
        "guest memory counters come from the Linux balloon device and do not exist for a macOS guest.",
      );
    },

    async snapshot() {
      throw unsupported(
        "snapshot",
        "macOS guest snapshots are not implemented. Apple saved state is encrypted to the " +
          "originating host, so it is not a portable snapshot.",
      );
    },

    async fork() {
      throw unsupported(
        "fork",
        "live fork is not implemented for macOS guests. Cold cloning is a separate future capability.",
      );
    },
  };
}

async function execOrThrow(
  exec: (cmd: string, opts?: Parameters<MacosTransport["exec"]>[1]) => Promise<VsockExecResult>,
  cmd: string,
  execOpts?: Parameters<MacosTransport["exec"]>[1],
): Promise<VsockExecResult> {
  const result = await exec(cmd, execOpts);
  if (result.exitCode !== 0) {
    throw new ExecError(
      "EXEC_NONZERO_EXIT",
      `vm.exec failed (code ${result.exitCode}): ${cmd}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

async function writeFileOverSsh(
  exec: (cmd: string, opts?: Parameters<MacosTransport["exec"]>[1]) => Promise<VsockExecResult>,
  guestPath: string,
  contents: Buffer | string,
  writeOpts?: WriteFileOptions,
): Promise<void> {
  const payload = typeof contents === "string" ? Buffer.from(contents) : contents;
  const encoded = payload.toString("base64");
  const dir = guestPath.slice(0, guestPath.lastIndexOf("/")) || "/";
  const mode = writeOpts?.mode === undefined ? "" : ` && chmod ${writeOpts.mode.toString(8)} `;
  const append = writeOpts?.append ? ">>" : ">";
  const script =
    `mkdir -p ${shellQuote(dir)} && ` +
    `printf %s ${shellQuote(encoded)} | base64 -d ${append} ${shellQuote(guestPath)}` +
    (mode ? `${mode}${shellQuote(guestPath)}` : "");
  const result = await exec(script);
  if (result.exitCode !== 0) {
    throw new ExecError(
      "EXEC_NONZERO_EXIT",
      `writeFile failed (code ${result.exitCode}): ${guestPath}\nstderr:\n${result.stderr}`,
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function unsupported(method: string, detail: string): Error {
  return new ExecError(
    "PROVIDER_UNSUPPORTED_OPERATION",
    `vm.${method}: unsupported for a macOS guest. ${detail}`,
  );
}

function inertWritable(): VmHandle["stdin"] {
  const stream = new PassThrough();
  stream.end();
  return stream;
}

function inertReadable(): VmHandle["stdout"] {
  const stream = new PassThrough();
  stream.end();
  return stream;
}
