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
  // /proc/<pid>/net/icmp{,6} entries — SOCK_DGRAM IPPROTO_ICMP{,V6}
  // ("unprivileged ping" sockets). Same kernel layout as raw, but
  // col 2's right half is the source port instead of the proto, so
  // only $10 (inode) is consulted by the scanner.
  icmpLines?: string[];
  icmp6Lines?: string[];
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
    writeFileSync(
      join(base, "net", "icmp"),
      rawHeader + (p.icmpLines ?? []).join("\n") + (p.icmpLines?.length ? "\n" : ""),
    );
    writeFileSync(
      join(base, "net", "icmp6"),
      rawHeader + (p.icmp6Lines ?? []).join("\n") + (p.icmp6Lines?.length ? "\n" : ""),
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

// Build a /proc/net/icmp{,6} line for an inode. The right half of $2
// is the source port for these (not the protocol); the scanner ignores
// it and hardcodes the proto based on which file the entry came from.
function icmpLine(inode: number, srcPort: number = 0): string {
  const portHex = srcPort.toString(16).toUpperCase().padStart(4, "0");
  return `   0: 00000000:${portHex} 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0  ${inode} 2 ffffffff 0`;
}

function runPreflight(procRoot: string, rootPid: number) {
  // Pin LIVE_MOUNTS_FILE to /dev/null so the #273 unmount check
  // no-ops; this suite exclusively exercises scan_raw_inet_sockets,
  // and a stray /etc/machinen-livemounts on the host (or future
  // tests' fixtures) shouldn't perturb that.
  return spawnSync("/bin/dash", [preflight, String(rootPid)], {
    encoding: "utf8",
    env: { ...process.env, PROC: procRoot, LIVE_MOUNTS_FILE: "/dev/null" },
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

  it('flags SOCK_DGRAM/IPPROTO_ICMP "ping" sockets (CRIU 3.17.1 rejects them)', () => {
    // CRIU 3.17.1's can_dump_ipproto (criu/sk-inet.c:128) only allows
    // non-SOCK_RAW sockets with proto ∈ {IP, TCP, UDP, UDPLITE}, so a
    // SOCK_DGRAM/IPPROTO_ICMP socket — what iputils-ping uses by
    // default once machinen-netup widens ping_group_range (#203) —
    // makes the dump fail. The scanner reports it as ipproto=1.
    const root = mkdtempSync(join(tmpdir(), "preflight-ping-icmp-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 9: "socket:[7777]" },
          icmpLines: [icmpLine(7777)],
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pid=100 fd=9 ipproto=1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags SOCK_DGRAM/IPPROTO_ICMPV6 ping sockets via /proc/net/icmp6", () => {
    const root = mkdtempSync(join(tmpdir(), "preflight-ping-icmp6-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 8: "socket:[8888]" },
          icmp6Lines: [icmpLine(8888)],
        },
      ]);
      const r = runPreflight(procRoot, 100);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pid=100 fd=8 ipproto=58/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores socket fds whose inode is in none of raw/raw6/icmp/icmp6", () => {
    // E.g. a TCP socket — listed in /proc/net/tcp, which the scanner
    // doesn't read (CRIU handles TCP fine). Must pass through.
    const root = mkdtempSync(join(tmpdir(), "preflight-tcp-ok-"));
    try {
      const procRoot = buildProc(root, [
        {
          pid: 100,
          fds: { 9: "socket:[7777]" },
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

// #273: in-guest live-share FUSE mount unmount step. The real umount
// path needs a real FUSE mount and root, which is smoke-test territory;
// here we cover the dispatcher (file present/absent, line parsing,
// skip-if-not-a-mountpoint) — the corners that decide whether umount
// is invoked at all.
describe("machinen-dump-preflight: unmount_live_mounts", () => {
  if (!hasDash()) {
    it.skip("requires /bin/dash", () => {});
    return;
  }

  // A clean-/proc fixture all of these reuse — we're exercising the
  // unmount loop, not the raw-socket scan, but the script runs both
  // checks unconditionally so we still need a synthetic /proc.
  function makeProc(root: string): string {
    return buildProc(root, [{ pid: 1 }]);
  }

  function runWith(args: { procRoot: string; liveMountsFile: string }) {
    return spawnSync("/bin/dash", [preflight, "1"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PROC: args.procRoot,
        LIVE_MOUNTS_FILE: args.liveMountsFile,
      },
    });
  }

  it("succeeds silently when LIVE_MOUNTS_FILE is absent", () => {
    // Bundles / boots without --mount-live never wrote the sidecar.
    // The unmount step has nothing to do; preflight should exit 0
    // without printing about it.
    const root = mkdtempSync(join(tmpdir(), "preflight-livemount-absent-"));
    try {
      const procRoot = makeProc(root);
      const missing = join(root, "definitely-not-here");
      const r = runWith({ procRoot, liveMountsFile: missing });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/refusing to dump/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("succeeds silently when LIVE_MOUNTS_FILE is empty", () => {
    // /init wrote an empty sidecar (zero liveMounts at boot — weird,
    // but the schema permits it). Same outcome as a missing file:
    // nothing to unmount, nothing to complain about.
    const root = mkdtempSync(join(tmpdir(), "preflight-livemount-empty-"));
    try {
      const procRoot = makeProc(root);
      const list = join(root, "livemounts");
      writeFileSync(list, "");
      const r = runWith({ procRoot, liveMountsFile: list });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/refusing to dump/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips entries whose guest path isn't currently a mountpoint", () => {
    // The sidecar describes the *intent* — a fuse-agent that died at
    // boot, or a path that was unmounted by the user already, leaves
    // a stale entry. Preflight just no-ops on those (mountpoint -q
    // returns 1) and moves on rather than failing the dump on
    // something already in the desired state.
    const root = mkdtempSync(join(tmpdir(), "preflight-livemount-stale-"));
    try {
      const procRoot = makeProc(root);
      const guestDir = join(root, "guest-not-mounted");
      mkdirSync(guestDir);
      const list = join(root, "livemounts");
      writeFileSync(list, `1970\t${guestDir}\n`);
      const r = runWith({ procRoot, liveMountsFile: list });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/refusing to dump/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores blank lines in the sidecar", () => {
    // Defensive: an editor or future writer adds a trailing newline
    // or splits writes across boundaries. The loop's `[ -n "$guest" ]
    // || continue` guard should keep us from invoking umount with an
    // empty target.
    const root = mkdtempSync(join(tmpdir(), "preflight-livemount-blanks-"));
    try {
      const procRoot = makeProc(root);
      const list = join(root, "livemounts");
      writeFileSync(list, "\n\n");
      const r = runWith({ procRoot, liveMountsFile: list });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/refusing to dump/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
