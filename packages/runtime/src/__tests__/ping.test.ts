// Regression test for #203: unprivileged ping inside the guest.
//
// Boots the production rootfs, drops a freshly-compiled
// `machinen-netup` (built from the in-tree C source) into the guest,
// runs it, and asserts:
//
//   1. /proc/sys/net/ipv4/ping_group_range is "0\t2147483647", i.e.
//      every gid is allowed to open IPPROTO_ICMP datagram sockets.
//   2. A non-root user (uid 501, matching what provision.ts creates)
//      can `ping -c1 127.0.0.1` and get a reply.
//
// Pinging loopback keeps the test off the public internet — the
// kernel's ICMP-datagram socket path is what the bug breaks, and
// loopback exercises it without any gvproxy round-trip.
//
// Skips when fixture requirements are explicitly disabled, zig isn't
// on PATH, or release-assets are missing.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boot } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");
const releaseAssets = resolve(microvmRoot, "../../release-assets");
const netupSrc = resolve(microvmRoot, "assets/machinen-netup.c");

function hasZig(): boolean {
  try {
    execSync("command -v zig", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function prereqs(): { rootfs: string; kernel: string; dtb: string } | undefined {
  if (process.env.MACHINEN_REQUIRE_FIXTURES === "0") {
    return undefined;
  }
  const rootfs = resolve(releaseAssets, "rootfs-debian-arm64.tar.gz");
  const kernel = resolve(releaseAssets, "Image-arm64");
  const dtb = resolve(releaseAssets, "virt-arm64.dtb");
  if (!existsSync(rootfs) || !existsSync(kernel) || !existsSync(dtb) || !existsSync(netupSrc)) {
    return undefined;
  }
  if (!hasZig()) {
    return undefined;
  }
  return { rootfs, kernel, dtb };
}

describe("machinen-netup unprivileged ping (#203)", () => {
  it("opens ping_group_range and lets a non-root user ping", async () => {
    const p = prereqs();
    if (!p) {
      console.warn(
        "skip ping integration: MACHINEN_REQUIRE_FIXTURES=0 or needs zig + release-assets/Image-arm64 + rootfs-debian-arm64.tar.gz",
      );
      return;
    }

    const buildDir = join(tmpdir(), `machinen-netup-${process.pid}`);
    mkdirSync(buildDir, { recursive: true });
    const netupBin = join(buildDir, "machinen-netup");
    execFileSync(
      "zig",
      ["cc", netupSrc, "-target", "aarch64-linux-musl", "-static", "-Os", "-o", netupBin],
      { stdio: "pipe" },
    );
    const netupBytes = readFileSync(netupBin);

    const vm = await boot({
      kernel: p.kernel,
      dtb: p.dtb,
      image: p.rootfs,
      cmd: ["/exec-agent"],
      env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin", HOME: "/root" },
      timeoutMs: null,
    });
    try {
      // Ship the freshly-built netup. We don't replace /sbin/machinen-netup
      // wholesale because /init already ran the old one at boot; instead
      // we reset the sysctl to its empty default and re-run the new
      // binary from scratch — that proves the source-side change is
      // what flips the sysctl, not residual state.
      await vm.writeFile("/sbin/machinen-netup-test", netupBytes, { mode: 0o755 });

      // useradd matches what provision.ts does for the dev user.
      await vm.execRaw("id dev >/dev/null 2>&1 || useradd -m -u 501 -s /bin/bash dev");

      // Reset to the upstream default empty range so the assertion
      // measures exactly what the new netup wrote.
      await vm.exec("printf '1\\t0\\n' > /proc/sys/net/ipv4/ping_group_range");

      // /init already brought the network up; running netup a second
      // time fails on `gw_set` (EEXIST) but the sysctl write is the
      // first thing in main() now, so we ignore that exit.
      await vm.execRaw("/sbin/machinen-netup-test || true");

      const range = await vm.exec("cat /proc/sys/net/ipv4/ping_group_range");
      expect(range.exitCode).toBe(0);
      // Tab-separated, trailing newline — kernel's canonical format.
      expect(range.stdout).toBe("0\t2147483647\n");

      const ping = await vm.execRaw("runuser -u dev -- ping -c1 -W2 127.0.0.1");
      expect(ping.exitCode, `ping output: ${ping.stdout}\n${ping.stderr}`).toBe(0);
      expect(ping.stdout).toMatch(/1 packets transmitted, 1 received/);
    } finally {
      await vm.kill();
    }
  }, 120_000);
});
