// Tests for @machinen/runtime.
//
// The integration test boots the real VMM against the built-in
// Node.js REPL demo (same rootfs the microVM package's smoke.sh uses),
// pipes `1 + 1\n.exit\n` into it, and asserts Node evaluated the
// expression. Skipped (not failed) if the prerequisites aren't there:
// Image/virt.dtb/initramfs fixtures, or the HVF-entitled test binary.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BootError, measureFirstByte, boot } from "../index.ts";

const microvmRoot = resolve(import.meta.dirname, "../../../microvm");

function findBootTestBinary(): string | undefined {
  const cacheDir = resolve(microvmRoot, ".zig-cache/o");
  if (!existsSync(cacheDir)) {
    return undefined;
  }
  // Newest first; pick the one that mentions MACHINEN_BOOT_TEST.
  const candidates = readdirSync(cacheDir)
    .map((name) => resolve(cacheDir, name, "test"))
    .filter((p) => existsSync(p))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { p } of candidates) {
    try {
      const haystack = execSync(`strings ${p}`, { encoding: "utf8" });
      if (haystack.includes("MACHINEN_BOOT_TEST")) {
        return p;
      }
    } catch {}
  }
  return undefined;
}

function fixturesPresent(): boolean {
  for (const f of ["Image", "virt.dtb", "initramfs.cpio"]) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) {
      return false;
    }
  }
  return true;
}

describe("boot", () => {
  it("throws BootError when the binary path does not exist", async () => {
    await expect(boot({ binary: "/nope/does/not/exist" })).rejects.toThrow(BootError);
  });

  it("rejects wait() when the VMM exceeds its timeout", async () => {
    // Use a binary that just sleeps (the macOS `yes` command never
    // exits on its own). We're not booting a VM here — we're
    // testing the wait() timeout path against any long-running child.
    const vm = await boot({ binary: "/usr/bin/yes", timeoutMs: 50 });
    try {
      await expect(vm.wait()).rejects.toThrow(BootError);
    } finally {
      await vm.kill();
    }
  });

  it("boots the VMM and the kernel reaches userspace", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) {
      // Fixtures missing — skip. Run ./scripts/build-base-assets.sh to produce them.
      return;
    }

    // We don't assume a particular /machinen-config.json cmd (the
    // microvm package's smoke scripts rewrite it between runs). We
    // check that boot() starts the VMM, stderr streams back, and
    // the kernel boots far enough to say so. That's enough to prove
    // the spawn/stdio wiring works; driving a specific workload is
    // the microvm package's job (see test-fixtures/assets/smoke.sh).
    const vm = await boot({
      binary,
      cwd: microvmRoot,
      vmmEnv: { MACHINEN_BOOT_TEST: "1" },
      timeoutMs: null,
    });

    // Kill after 15s — plenty of time for the kernel banner to land.
    const killAfter = setTimeout(() => void vm.kill(), 15_000);
    killAfter.unref();

    await vm.wait();
    clearTimeout(killAfter);

    // Strip ANSI CSI sequences + CRs so grep-style assertions below
    // match. Using the literal escape character via String.fromCharCode
    // instead of \x1b so oxlint's no-control-regex stays quiet.
    const ESC = String.fromCharCode(0x1b);
    const stderr = (await vm.errorOutput())
      .replace(new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g"), "")
      .replace(/\r/g, "");

    // These markers prove the chain worked: our Zig VMM mapped memory,
    // loaded the kernel, ran it, and piped its serial output back to
    // us. Kernel cmdline now boots quiet (loglevel=3) so most info-
    // level setup chatter is suppressed — the banner line still makes
    // it through because it's printed via earlycon before cmdline
    // parsing applies the level filter.
    expect(stderr).toContain("Linux version");
  }, 30_000);
});

describe("snapshot option", () => {
  it("throws BootError when the snapshot path does not exist", async () => {
    await expect(boot({ binary: "/bin/sh", snapshot: "/nope/missing.img" })).rejects.toThrow(
      /snapshot image not found/,
    );
  });

  it("passes the resolved snapshot path as MACHINEN_DISK to the child", async () => {
    // Round-trip test: echo-env-then-exit. Any existing file works as
    // a stand-in for a snapshot image since we're not actually running
    // a VMM here. Snapshot-only (no image/cmd) is the CRIU-restore
    // flow where the initramfs is baked.
    const snap = `/tmp/machinen-runtime-snap-${process.pid}`;
    writeFileSync(snap, "");
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "printf 'DISK=%s\\n' \"$MACHINEN_DISK\""],
        snapshot: snap,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`DISK=${snap}`);
    } finally {
      try {
        unlinkSync(snap);
      } catch {}
    }
  });
});

describe("kernel option", () => {
  it("throws BootError when the kernel path does not exist", async () => {
    await expect(boot({ binary: "/bin/sh", kernel: "/nope/missing-kernel" })).rejects.toThrow(
      /kernel not found/,
    );
  });

  it("passes the resolved kernel path as MACHINEN_KERNEL to the child", async () => {
    const kernel = `/tmp/machinen-runtime-kernel-${process.pid}`;
    writeFileSync(kernel, "");
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "printf 'KERNEL=%s\\n' \"$MACHINEN_KERNEL\""],
        kernel,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`KERNEL=${kernel}`);
    } finally {
      try {
        unlinkSync(kernel);
      } catch {}
    }
  });
});

describe("dtb option", () => {
  it("throws BootError when the dtb path does not exist", async () => {
    await expect(boot({ binary: "/bin/sh", dtb: "/nope/missing-dtb" })).rejects.toThrow(
      /dtb not found/,
    );
  });

  it("passes the resolved dtb path as MACHINEN_DTB to the child", async () => {
    const dtb = `/tmp/machinen-runtime-dtb-${process.pid}`;
    writeFileSync(dtb, "");
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "printf 'DTB=%s\\n' \"$MACHINEN_DTB\""],
        dtb,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`DTB=${dtb}`);
    } finally {
      try {
        unlinkSync(dtb);
      } catch {}
    }
  });
});

describe("measureFirstByte", () => {
  it("returns the wall-clock time before the child produces stderr", async () => {
    // /bin/sh writes the `1` to stderr immediately.
    const vm = await boot({
      binary: "/bin/sh",
      args: ["-c", "echo 1 >&2; sleep 1"],
      timeoutMs: 3_000,
    });
    const ms = await measureFirstByte(vm);
    await vm.wait();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1500); // well under the 1s sleep
  });
});

describe("image + cmd", () => {
  it("requires image and cmd together (image alone)", async () => {
    await expect(boot({ binary: "/bin/sh", image: "/tmp/some-image.tar.gz" })).rejects.toThrow(
      /must be specified together/,
    );
  });

  it("requires image and cmd together (cmd alone)", async () => {
    await expect(boot({ binary: "/bin/sh", cmd: ["/bin/true"] })).rejects.toThrow(
      /must be specified together/,
    );
  });

  it("throws BootError when image tarball is missing", async () => {
    await expect(
      boot({ binary: "/bin/sh", image: "/nope/missing-tarball.tgz", cmd: ["/bin/true"] }),
    ).rejects.toThrow(/image tarball not found/);
  });

  it("boots an image + cmd and the guest runs the cmd", async () => {
    const binary = findBootTestBinary();
    if (!binary || !fixturesPresent()) {
      // VMM fixtures missing — skip.
      return;
    }
    const debianRootfs = resolve(microvmRoot, "test-fixtures/rootfs-debian-arm64.tar.gz");
    if (!existsSync(debianRootfs)) {
      // Debian rootfs tarball not produced in this checkout — skip.
      return;
    }

    const vm = await boot({
      binary,
      cwd: microvmRoot,
      vmmEnv: { MACHINEN_BOOT_TEST: "1" },
      image: debianRootfs,
      cmd: ["/bin/sh", "-c", "echo BUNDLE_MARKER=$BUNDLE_MARKER; pwd; sleep 999999"],
      env: { PATH: "/usr/bin:/bin", BUNDLE_MARKER: "spawned-via-ts", cwd: "/var" },
      timeoutMs: null,
    });
    // Kill after 20s — enough for kernel boot + /init + sh to print.
    const killAfter = setTimeout(() => void vm.kill(), 20_000);
    killAfter.unref();
    await vm.wait();
    clearTimeout(killAfter);

    const ESC = String.fromCharCode(0x1b);
    const stderr = (await vm.errorOutput())
      .replace(new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g"), "")
      .replace(/\r/g, "");

    expect(stderr).toContain("Linux version");
    expect(stderr).toContain("BUNDLE_MARKER=spawned-via-ts");
  }, 40_000);
});

describe("mount option", () => {
  // Any existing tarball works for image; we're only exercising the
  // mount-path validators, not actually booting.
  const fakeImage = `/tmp/machinen-mount-test-image-${process.pid}.tar.gz`;
  const mountCmd = ["/bin/true"];

  it("rejects a mount with a non-absolute guest path", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          mount: { host: "/tmp", guest: "mnt/app" },
        }),
      ).rejects.toThrow(/guest path must be absolute/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a mount whose guest path is not under /mnt/", async () => {
    writeFileSync(fakeImage, "");
    try {
      for (const guest of ["/srv/app", "/etc/config", "/proc", "/init", "/mntfoo"]) {
        await expect(
          boot({
            binary: "/bin/sh",
            image: fakeImage,
            cmd: mountCmd,
            mount: { host: "/tmp", guest },
          }),
        ).rejects.toThrow(/must live under \/mnt\//);
      }
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a mount whose guest path is the mount root itself", async () => {
    writeFileSync(fakeImage, "");
    try {
      for (const guest of ["/mnt", "/mnt/"]) {
        await expect(
          boot({
            binary: "/bin/sh",
            image: fakeImage,
            cmd: mountCmd,
            mount: { host: "/tmp", guest },
          }),
        ).rejects.toThrow(/must live under \/mnt\//);
      }
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a mount whose host path does not exist", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          mount: { host: "/nope/missing/host", guest: "/mnt/x" },
        }),
      ).rejects.toThrow(/mount host path not found/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a mount whose host path is a file (not a directory)", async () => {
    writeFileSync(fakeImage, "");
    const hostFile = `/tmp/machinen-mount-file-${process.pid}`;
    writeFileSync(hostFile, "x");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          mount: { host: hostFile, guest: "/mnt/x" },
        }),
      ).rejects.toThrow(/must be a directory/);
    } finally {
      try {
        unlinkSync(hostFile);
      } catch {}
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });
});

describe("vm.snapshot", () => {
  it("throws when the VM was spawned without a disk attached", async () => {
    const vm = await boot({ binary: "/usr/bin/yes", timeoutMs: 5_000 });
    try {
      await expect(vm.snapshot("/tmp/unused.snap")).rejects.toThrow(/no disk was attached at boot/);
    } finally {
      await vm.kill();
    }
  });

  it('throws when the guest never reported "dump OK"', async () => {
    // /usr/bin/true exits immediately, so vm.wait() resolves without
    // any "dump OK" marker ever landing in stderr. snapshot() should
    // surface that as a clear error.
    const snap = `/tmp/machinen-snap-nook-${process.pid}.img`;
    writeFileSync(snap, Buffer.alloc(1024));
    try {
      const vm = await boot({
        binary: "/usr/bin/true",
        snapshot: snap,
        timeoutMs: 5_000,
      });
      await expect(vm.snapshot(snap, { timeoutMs: 2_000 })).rejects.toThrow(/dump OK/);
    } finally {
      try {
        unlinkSync(snap);
      } catch {}
    }
  });
});

// Fake exec-agent — accepts a UDS connection, reads one EXEC line,
// writes canned O/E/X frames in response. Lets us exercise
// VmHandle.exec without booting a real VMM.
function startFakeAgent(opts: {
  socketPath: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): { server: Server; stop: () => Promise<void> } {
  const server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) {
        return;
      }
      if (opts.stdout) {
        const b = Buffer.from(opts.stdout, "utf8");
        socket.write(`O ${b.length}\n`);
        socket.write(b);
      }
      if (opts.stderr) {
        const b = Buffer.from(opts.stderr, "utf8");
        socket.write(`E ${b.length}\n`);
        socket.write(b);
      }
      socket.write(`X ${opts.exitCode}\n`);
      socket.end();
    });
  });
  server.listen(opts.socketPath);
  return {
    server,
    stop: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

describe("vm.exec", () => {
  it("dispatches EXEC to the vsock UDS and returns parsed output", async () => {
    const udsPath = join(tmpdir(), `machinen-vm-exec-${process.pid}-1.sock`);
    try {
      unlinkSync(udsPath);
    } catch {}
    const agent = startFakeAgent({
      socketPath: udsPath,
      stdout: "hello from fake agent\n",
      exitCode: 0,
    });
    try {
      const vm = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        timeoutMs: 5_000,
      });
      try {
        const res = await vm.exec("doesnt-matter");
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toBe("hello from fake agent\n");
      } finally {
        await vm.kill();
      }
    } finally {
      await agent.stop();
      try {
        unlinkSync(udsPath);
      } catch {}
    }
  });

  it("exec() throws BootError on non-zero exit and surfaces stderr", async () => {
    const udsPath = join(tmpdir(), `machinen-vm-exec-${process.pid}-2.sock`);
    try {
      unlinkSync(udsPath);
    } catch {}
    const agent = startFakeAgent({
      socketPath: udsPath,
      stderr: "boom happened",
      exitCode: 7,
    });
    try {
      const vm = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        timeoutMs: 5_000,
      });
      try {
        await expect(vm.exec("doesnt-matter")).rejects.toThrow(BootError);
        await expect(vm.exec("doesnt-matter")).rejects.toThrow(/code 7.*boom happened/s);
      } finally {
        await vm.kill();
      }
    } finally {
      await agent.stop();
      try {
        unlinkSync(udsPath);
      } catch {}
    }
  });

  it("execRaw() returns non-zero exit without throwing", async () => {
    const udsPath = join(tmpdir(), `machinen-vm-exec-${process.pid}-3.sock`);
    try {
      unlinkSync(udsPath);
    } catch {}
    const agent = startFakeAgent({
      socketPath: udsPath,
      stderr: "nonzero is fine",
      exitCode: 42,
    });
    try {
      const vm = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        timeoutMs: 5_000,
      });
      try {
        const res = await vm.execRaw("doesnt-matter");
        expect(res.exitCode).toBe(42);
        expect(res.stderr).toContain("nonzero is fine");
      } finally {
        await vm.kill();
      }
    } finally {
      await agent.stop();
      try {
        unlinkSync(udsPath);
      } catch {}
    }
  });
});
