// SSH and SFTP transport for macOS guests.
//
// Key-based only. Every invocation runs with `BatchMode=yes` so a missing
// key fails instead of falling back to an interactive password prompt, and
// host keys are checked against a per-VM known_hosts file. Secret material
// never reaches argv, logs, or the registry.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ExecError } from "../../errors.ts";
import type { VsockExecOptions, VsockExecResult } from "../../exec.ts";
import type { MacosSshOptions } from "./config.ts";

/** SSH options that make the connection non-interactive and key-only. */
const BASE_ARGS: readonly string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "PasswordAuthentication=no",
  "-o",
  "KbdInteractiveAuthentication=no",
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=15",
];

export interface MacosTransport {
  exec(cmd: string, opts?: VsockExecOptions): Promise<VsockExecResult>;
  push(hostDir: string, guestPath: string): Promise<void>;
  pull(guestPath: string, hostDir: string): Promise<void>;
}

export interface MacosTransportOptions {
  ssh: MacosSshOptions;
  host: string;
  /** Directory holding the managed known_hosts file. */
  stateDir: string;
}

/**
 * Build the transport for a running guest. `host` comes from the runner's
 * status file, never from user input alone, so the address matches the VM
 * that was actually started.
 */
export function createMacosTransport(opts: MacosTransportOptions): MacosTransport {
  const knownHosts = join(opts.stateDir, "known_hosts");
  writeFileSync(knownHosts, "", { flag: "a" });
  const target = `${opts.ssh.user}@${opts.host}`;
  const port = opts.ssh.port ?? 22;
  const common = [
    ...BASE_ARGS,
    "-o",
    `UserKnownHostsFile=${knownHosts}`,
    "-p",
    String(port),
    "-i",
    opts.ssh.identityFile,
  ];

  return {
    exec(cmd, execOpts) {
      return runSsh(common, target, cmd, execOpts);
    },
    async push(hostDir, guestPath) {
      await runScp(common, hostDir, `${target}:${guestPath}`, true);
    },
    async pull(guestPath, hostDir) {
      await runScp(common, `${target}:${guestPath}`, hostDir, false);
    },
  };
}

function runSsh(
  common: string[],
  target: string,
  cmd: string,
  opts: VsockExecOptions = {},
): Promise<VsockExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...common, target, cmd], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = startTimeout(opts.execTimeoutMs, () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(
        new ExecError("EXEC_AGENT_TIMEOUT", `macOS SSH exec timed out: ${cmd}`, {
          retryable: true,
        }),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
      opts.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err.push(chunk);
      opts.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      stopTimeout(timer);
      reject(
        new ExecError("EXEC_AGENT_UNAVAILABLE", `macOS SSH transport failed: ${error.message}`, {
          retryable: true,
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      stopTimeout(timer);
      resolve({
        exitCode: code ?? 255,
        stdout: opts.onStdout ? "" : Buffer.concat(out).toString("utf8"),
        stderr: opts.onStderr ? "" : Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

function runScp(common: string[], from: string, to: string, recursive: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-q", ...common, ...(recursive ? ["-r"] : []), from, to];
    const child = spawn("scp", args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      reject(
        new ExecError("EXEC_AGENT_UNAVAILABLE", `macOS SCP transport failed: ${error.message}`, {
          retryable: true,
          cause: error,
        }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new ExecError(
          "EXEC_NONZERO_EXIT",
          `macOS SCP failed (code ${String(code)}): ${Buffer.concat(err).toString("utf8")}`,
        ),
      );
    });
  });
}

function startTimeout(ms: number | null | undefined, onTimeout: () => void): NodeJS.Timeout | null {
  if (ms === null || ms === Infinity) {
    return null;
  }
  const timer = setTimeout(onTimeout, ms ?? 300_000);
  timer.unref?.();
  return timer;
}

function stopTimeout(timer: NodeJS.Timeout | null): void {
  if (timer) {
    clearTimeout(timer);
  }
}

/** Temp directory for per-VM transport state such as known_hosts. */
export function makeTransportStateDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-macos-ssh-"));
}
