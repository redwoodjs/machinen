// Unit test for /sbin/machinen-dump-preflight — the in-guest scan that
// runs before `criu dump` and refuses trees holding raw IP sockets
// (CRIU has no encoder for SOCK_RAW of any IPPROTO_*, so dumping such
// a tree fails deep in sk-inet.c with "Unsupported proto N for socket
// M"). Exercises the script directly under dash against a synthetic
// /proc tree built in a tmpdir; no VM boot needed.
//
// Skips when /bin/dash isn't present (we ship the helper as a POSIX
// /bin/sh script and want test parity with the in-guest interpreter).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preflight = resolve(
  import.meta.dirname,
  "../../../microvm/assets/machinen-dump-preflight.sh",
);

function hasDash(): boolean {
  try {
    execFileSync("/bin/dash", ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Build a synthetic /proc with the given pid layout. Returns the path
// to use as $PROC. The caller is responsible for rmSync-ing the
// returned tmpdir's root.
type FakePid = {
  pid: number;
  children?: number[];
  // fds: numeric fd → readlink target (e.g. "socket:[5648]" or
  // "/dev/null"). Anything not starting with "socket:" is wired up as
  // a symlink to /dev/null so [ -L ] passes.
  fds?: Record<number, string>;
  // Lines to drop into /proc/<pid>/net/raw (excluding the header,
  // which we synthesize). Each line is the raw kernel format, only
  // the local_address ($2) and inode ($10) fields actually matter.
  rawLines?: string[];
  raw6Lines?: string[];
};

function buildProc(root: string, pids: FakePid[]): string {
  const procRoot = join(root, "proc");
  mkdirSync(procRoot, { recursive: true });
  for (const p of pids) {
    const base = join(procRoot, String(p.pid));
    mkdirSync(join(base, "task", String(p.pid)), { recursive: true });
    mkdirSync(join(base, "fd"), { recursive: true });
    mkdirSync(join(base, "net"), { recursive: true });

    writeFileSync(
      join(base, "task", String(p.pid), "children"),
      (p.children ?? []).map(String).join(" ") + (p.children?.length ? "\n" : ""),
    );

    for (const [fd, target] of Object.entries(p.fds ?? {})) {
      // For "socket:[N]" targets we still need readlink to return the
      // string. Linux exposes these via symlinks whose link-target IS
      // the literal "socket:[N]" — readlink reports it verbatim. Plain
      // POSIX symlinks behave the same: the link target is whatever
      // string we pass. So we can just symlink to the literal value.
      symlinkSync(target, join(base, "fd", fd));
    }

    const rawHeader =
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops\n";
    writeFileSync(
      join(base, "net", "raw"),
      rawHeader + (p.rawLines ?? []).join("\n") + (p.rawLines?.length ? "\n" : ""),
    );
    writeFileSync(
      join(base, "net", "raw6"),
      rawHeader + (p.raw6Lines ?? []).join("\n") + (p.raw6Lines?.length ? "\n" : ""),
    );
  }
  return procRoot;
}

// Build a /proc/net/raw line for an inode + IPPROTO. The kernel format
// stuffs the protocol into the "remote port" half of $2 (local_address),
// uppercase hex, two digits.
function rawLine(inode: number, ipproto: number): string {
  const hex = ipproto.toString(16).toUpperCase().padStart(4, "0");
  return `   0: 00000000:${hex} 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0  ${inode} 2 ffffffff 0`;
}

function runPreflight(procRoot: string, rootPid: number) {
  return spawnSync("/bin/dash", [preflight, String(rootPid)], {
    encoding: "utf8",
    env: { ...process.env, PROC: procRoot },
  });
}

describe("machinen-dump-preflight", () => {
  if (!hasDash()) {
    it.skip("requires /bin/dash", () => {});
    return;
  }

  it("passes when no descendant holds a raw IP socket", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-clean-"));
    try {
      const procRoot = buildProc(root, [
        { pid: 100, children: [200] },
        // pid 200 holds a regular fd to /dev/null — readlink target
        // doesn't start with "socket:[", so the scanner ignores it.
        { pid: 200, fds: { 3: "/dev/null" } },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      expect(r.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags a raw-ICMP socket on a descendant pid with pid+fd+ipproto", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-raw-icmp-"));
    try {
      const procRoot = buildProc(root, [
        { pid: 100, children: [200] },
        {
          pid: 200,
          fds: { 5: "socket:[5648]" },
          rawLines: [rawLine(5648, 1)], // IPPROTO_ICMP
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/raw IP socket/);
      expect(r.stderr).toMatch(/pid=200 fd=5 ipproto=1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags raw sockets of other IPPROTO_* values too (e.g. IPPROTO_TCP=6)", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-raw-tcp-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 7: "socket:[12345]" },
          rawLines: [rawLine(12345, 6)],
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pid=100 fd=7 ipproto=6/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores socket fds whose inode is not in /proc/net/raw{,6}", () => {
    // Specifically: a SOCK_DGRAM/IPPROTO_ICMP "ping" socket lives in
    // /proc/net/icmp, NOT /proc/net/raw — CRIU 3.17+ supports it, so
    // the scan must NOT flag it.
    const root = mkdtempSync(join(tmpdir(), "preflight-ping-ok-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 9: "socket:[7777]" },
          // /proc/net/raw is empty — the inode 7777 is not a raw socket.
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status, `stderr=${r.stderr}`).toBe(0);
      expect(r.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walks deep descendant trees, not just direct children", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-deep-"));
    try {
      const procRoot = buildProc(root, [
        { pid: 100, children: [200] },
        { pid: 200, children: [300] },
        {
          pid: 300,
          fds: { 4: "socket:[42]" },
          rawLines: [rawLine(42, 1)],
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pid=300 fd=4 ipproto=1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles raw6 (IPv6 raw sockets)", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-raw6-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 6: "socket:[314]" },
          // ICMPv6 = 58 (0x3A); use the IPv6 file.
          raw6Lines: [rawLine(314, 58)],
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pid=100 fd=6 ipproto=58/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
