// Tests for @machinen/runtime.
//
// The integration test boots the real VMM against the built-in
// Node.js REPL demo (same rootfs the microVM package's smoke.sh uses),
// pipes `1 + 1\n.exit\n` into it, and asserts Node evaluated the
// expression. Skipped (not failed) if the prerequisites aren't there:
// Image/virt.dtb/initramfs fixtures, or the HVF-entitled test binary.

import { execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BootError, ExecError, buildMachinenConfig, measureFirstByte, boot } from "../index.ts";
import { ensurePdeathsig } from "../pdeathsig.ts";

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

const FIXTURE_FILES = ["Image", "virt.dtb", "initramfs.cpio"];

// #212: replace silent `return` skips on missing fixtures with a loud
// failure so a stale or absent kernel can't masquerade as a passing
// run. Set MACHINEN_REQUIRE_FIXTURES=0 to keep the legacy skip on
// hosts that can't build the microVM artifacts (CI smoke runners,
// docs-only contributors).
function requireFixturesOrSkip(extraPaths: string[] = []): {
  skip: boolean;
  binary: string;
} {
  const binary = findBootTestBinary();
  const missing: string[] = [];
  if (!binary) {
    missing.push("microvm/.zig-cache boot-test binary");
  }
  for (const f of FIXTURE_FILES) {
    if (!existsSync(resolve(microvmRoot, "test-fixtures", f))) {
      missing.push(`test-fixtures/${f}`);
    }
  }
  for (const p of extraPaths) {
    if (!existsSync(p)) {
      missing.push(p);
    }
  }
  if (missing.length === 0) {
    return { skip: false, binary: binary! };
  }
  if (process.env.MACHINEN_REQUIRE_FIXTURES === "0") {
    return { skip: true, binary: "" };
  }
  throw new Error(
    `test requires microVM fixtures (missing: ${missing.join(", ")}); ` +
      `run scripts/build-base-assets.sh + pnpm provision ` +
      `(or set MACHINEN_REQUIRE_FIXTURES=0 to opt out)`,
  );
}

describe("boot", () => {
  it("throws BootError when the binary path does not exist", async () => {
    await expect(boot({ binary: "/nope/does/not/exist" })).rejects.toThrow(BootError);
  });

  // #200: the VMM was spawned without parent-death wiring, so a
  // SIGKILL of the runtime process orphaned `machinen-vm` to PID 1
  // with the rootdisk fd and ~1.7 GiB RSS still held. Wrap the spawn
  // through the same shim `spawnGvproxy` uses; assert end-to-end that
  // the VMM dies with its parent.
  it("VMM dies with the parent process (#200)", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return; // shim is no-op on other platforms
    }
    const shim = await ensurePdeathsig();
    if (!shim) {
      // No C toolchain — graceful-fallback path is still safe (issue #200
      // notes the unwrapped behavior is the previous status quo). Nothing
      // for this test to assert.
      console.warn("pdeathsig shim unavailable; skipping VMM orphan test");
      return;
    }

    const fixture = resolve(import.meta.dirname, "fixtures/boot-and-hold.ts");
    // `node --import tsx` keeps everything in a single node process —
    // important here, because we need the SIGKILL'd process to be the
    // VMM's direct parent. (The `tsx` CLI binary spawns its target as
    // a child, which would put another layer between us and the VMM.)
    const parent = spawn(process.execPath, ["--import", "tsx", fixture], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pidLine = await new Promise<number>((res, rej) => {
      let buf = "";
      const t = setTimeout(() => rej(new Error("never received VMM_PID")), 30_000);
      parent.stdout!.on("data", (c: Buffer) => {
        buf += c.toString();
        const m = buf.match(/VMM_PID=(\d+)/);
        if (m) {
          clearTimeout(t);
          res(Number(m[1]));
        }
      });
      parent.once("error", rej);
      parent.once("exit", (code, signal) => {
        if (!buf.match(/VMM_PID=(\d+)/)) {
          clearTimeout(t);
          rej(new Error(`fixture exited before reporting VMM_PID (code=${code} sig=${signal})`));
        }
      });
    });

    const pidAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code !== "ESRCH";
      }
    };
    expect(pidAlive(pidLine)).toBe(true);

    // SIGKILL the parent. With the shim in place, `pidLine` (the VMM
    // wrapper on darwin, the VMM directly on linux) must die within a
    // few hundred ms.
    parent.kill("SIGKILL");

    const deadline = Date.now() + 5_000;
    let gone = false;
    while (Date.now() < deadline) {
      if (!pidAlive(pidLine)) {
        gone = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!gone) {
      // Last-resort cleanup so we don't leak a sleep(1) across runs.
      try {
        process.kill(pidLine, "SIGKILL");
      } catch {}
    }
    expect(gone).toBe(true);
  }, 60_000);

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
    const { skip, binary } = requireFixturesOrSkip();
    if (skip) {
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

  it("passes a per-boot reflink-clone of the snapshot path as MACHINEN_DISK", async () => {
    // The runtime reflink-clones the bundle disk into tmpdir() so a
    // chained snapshot can mkfs the disk without corrupting the source
    // bundle (#207). MACHINEN_DISK is the clone, not the original.
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
      const m = out.trim().match(/^DISK=(.+)$/);
      expect(m, `unexpected output: ${out.trim()}`).not.toBeNull();
      expect(m![1]).not.toBe(snap);
      expect(m![1]).toMatch(/machinen-snap-restore-.*\.img$/);
    } finally {
      try {
        unlinkSync(snap);
      } catch {}
    }
  });

  it("synthesizes /sbin/machinen-restore even when the image carries a baked cmd", async () => {
    // Restore against an image whose tarball has a baked default cmd
    // (e.g. `provision({ cmd })`). The snapshot helper must take
    // precedence over the baked cmd — replaying the baked cmd would
    // launch a fresh workload and silently drop the in-memory state
    // CRIU was supposed to restore (counter starts back at 0). The
    // /bin/sh stand-in copies the synthesized machinen-config.json
    // out of the bundle dir (sibling of $MACHINEN_INITRD) so we can
    // assert what /init would have run.
    const imgDir = mkdtempSync(join(tmpdir(), "machinen-snap-baked-"));
    const imgPath = `${imgDir}.tar.gz`;
    const snap = `/tmp/machinen-runtime-snap-baked-${process.pid}`;
    const dumpPath = `/tmp/machinen-runtime-config-dump-${process.pid}`;
    writeFileSync(snap, "");
    try {
      writeFileSync(
        join(imgDir, "machinen-config.json"),
        JSON.stringify({ cmd: ["/usr/bin/node", "/opt/counter.mjs"] }),
      );
      execSync(`tar -czf ${imgPath} -C ${imgDir} .`);
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", `cp "$(dirname "$MACHINEN_INITRD")/bundle/machinen-config.json" ${dumpPath}`],
        image: imgPath,
        snapshot: snap,
        rootDisk: false,
        timeoutMs: 3_000,
      });
      await vm.wait();
      const config = JSON.parse(readFileSync(dumpPath, "utf8")) as { cmd: string[] };
      expect(config.cmd).toEqual(["/sbin/machinen-restore"]);
    } finally {
      try {
        unlinkSync(snap);
      } catch {}
      try {
        unlinkSync(imgPath);
      } catch {}
      try {
        unlinkSync(dumpPath);
      } catch {}
      rmSync(imgDir, { recursive: true, force: true });
    }
  });

  it("does not set MACHINEN_DISK on a VMM-only boot (no image)", async () => {
    // Without `image`, the auto-scratch is skipped — VMM-only smoke
    // boots have nothing to dump. End-to-end auto-allocation lands on
    // the integration tests that boot a real rootfs.
    const vm = await boot({
      binary: "/bin/sh",
      args: ["-c", "printf 'DISK=[%s]\\n' \"${MACHINEN_DISK:-}\""],
      timeoutMs: 2_000,
    });
    await vm.wait();
    const out = await vm.output();
    expect(out.trim()).toBe("DISK=[]");
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
  it("rejects cmd without image", async () => {
    await expect(boot({ binary: "/bin/sh", cmd: ["/bin/true"] })).rejects.toThrow(
      /`image` is required when `cmd` is set/,
    );
  });

  it("allows image alone when the image carries a baked-in cmd", async () => {
    // Build a tiny tarball that has `/machinen-config.json` with a
    // default cmd. boot() should read it and not complain about the
    // missing `cmd` arg. (We use /bin/sh as the binary so no real
    // VMM boot happens — we're exercising the validation + synthesis
    // paths, not the kernel.)
    const imgDir = mkdtempSync(join(tmpdir(), "machinen-baked-image-"));
    const imgPath = `${imgDir}.tar.gz`;
    try {
      writeFileSync(join(imgDir, "machinen-config.json"), JSON.stringify({ cmd: ["/bin/true"] }));
      execSync(`tar -czf ${imgPath} -C ${imgDir} .`);
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "true"],
        image: imgPath,
        // Skip the rootDisk materialize step: this test exercises the
        // baked-config code path with /bin/sh as a stand-in VMM, so
        // hashing + mkfs the placeholder tarball would fail (no
        // e2fsprogs on the test runner) without exercising anything
        // we actually care about here.
        rootDisk: false,
        timeoutMs: 3_000,
      });
      await vm.wait();
    } finally {
      try {
        unlinkSync(imgPath);
      } catch {}
      rmSync(imgDir, { recursive: true, force: true });
    }
  });

  it("throws when neither the caller nor the image supplies a cmd", async () => {
    // Image tarball with no /machinen-config.json — boot() should
    // error with a clear "no cmd" message.
    const imgDir = mkdtempSync(join(tmpdir(), "machinen-empty-image-"));
    const imgPath = `${imgDir}.tar.gz`;
    try {
      writeFileSync(join(imgDir, "placeholder"), "x");
      execSync(`tar -czf ${imgPath} -C ${imgDir} .`);
      await expect(boot({ binary: "/bin/sh", image: imgPath, timeoutMs: 3_000 })).rejects.toThrow(
        /no cmd to run/,
      );
    } finally {
      try {
        unlinkSync(imgPath);
      } catch {}
      rmSync(imgDir, { recursive: true, force: true });
    }
  });

  it("throws BootError when image tarball is missing", async () => {
    await expect(
      boot({ binary: "/bin/sh", image: "/nope/missing-tarball.tgz", cmd: ["/bin/true"] }),
    ).rejects.toThrow(/image tarball not found/);
  });

  it("boots an image + cmd and the guest runs the cmd", async () => {
    // Sibling tests (exec.test.ts, ping.test.ts, provision.test.ts) all
    // resolve the base rootfs out of release-assets/, which is where
    // build-base-assets.sh actually writes it. test-fixtures/ only ever
    // gets the kernel + DTB synced in (vitest.setup.ts), never the
    // rootfs tarball — pointing at it there made this test guaranteed
    // to fail on every host.
    const debianRootfs = resolve(microvmRoot, "../../release-assets/rootfs-debian-arm64.tar.gz");
    const { skip, binary } = requireFixturesOrSkip([debianRootfs]);
    if (skip) {
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

describe("buildMachinenConfig (cwd)", () => {
  const baseInput = {
    cmd: ["/bin/true"],
    env: {},
    liveMounts: [],
  };

  it("writes guestCwd into the config as `cwd`", () => {
    const cfg = buildMachinenConfig({ ...baseInput, guestCwd: "/mnt/workspace" });
    expect(cfg.cwd).toBe("/mnt/workspace");
  });

  it("omits the `cwd` key when neither guestCwd nor imageCwd is set", () => {
    const cfg = buildMachinenConfig({ ...baseInput });
    expect("cwd" in cfg).toBe(false);
  });

  it("falls back to imageCwd when guestCwd is unset", () => {
    const cfg = buildMachinenConfig({ ...baseInput, imageCwd: "/srv/app" });
    expect(cfg.cwd).toBe("/srv/app");
  });

  it("guestCwd overrides imageCwd", () => {
    const cfg = buildMachinenConfig({
      ...baseInput,
      guestCwd: "/mnt/workspace",
      imageCwd: "/srv/app",
    });
    expect(cfg.cwd).toBe("/mnt/workspace");
  });
});

describe("guestCwd option", () => {
  const fakeImage = `/tmp/machinen-cwd-test-image-${process.pid}.tar.gz`;
  const cmd = ["/bin/true"];

  it("rejects a relative guestCwd", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd,
          guestCwd: "relative/dir",
        }),
      ).rejects.toThrow(/guestCwd must be an absolute path/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects an empty guestCwd", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd,
          guestCwd: "",
        }),
      ).rejects.toThrow(/guestCwd must be an absolute path/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a guestCwd with NUL bytes", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd,
          guestCwd: "/mnt/work\0space",
        }),
      ).rejects.toThrow(/must not contain NUL/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });
});

describe("liveMounts option", () => {
  const fakeImage = `/tmp/machinen-livemount-test-image-${process.pid}.tar.gz`;
  const mountCmd = ["/bin/true"];

  it("rejects a live mount with a non-absolute guest path", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          liveMounts: [{ host: "/tmp", guest: "mnt/app" }],
        }),
      ).rejects.toThrow(/guest path must be absolute/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a live mount with a host path outside /mnt/", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          liveMounts: [{ host: "/tmp", guest: "/srv/app" }],
        }),
      ).rejects.toThrow(/must live under \/mnt\//);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a live mount with a missing host directory", async () => {
    writeFileSync(fakeImage, "");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          liveMounts: [{ host: "/nope/missing", guest: "/mnt/x" }],
        }),
      ).rejects.toThrow(/liveMounts\[0\] host path not found/);
    } finally {
      try {
        unlinkSync(fakeImage);
      } catch {}
    }
  });

  it("rejects a live mount with a host path that is a file", async () => {
    writeFileSync(fakeImage, "");
    const hostFile = `/tmp/machinen-livemount-file-${process.pid}`;
    writeFileSync(hostFile, "x");
    try {
      await expect(
        boot({
          binary: "/bin/sh",
          image: fakeImage,
          cmd: mountCmd,
          liveMounts: [{ host: hostFile, guest: "/mnt/x" }],
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
  it("throws when the VM was spawned with snapshot: false", async () => {
    const vm = await boot({ binary: "/usr/bin/yes", snapshot: false, timeoutMs: 5_000 });
    try {
      await expect(vm.snapshot({ outDir: "/tmp/unused-snap-out" })).rejects.toThrow(
        /booted with `snapshot: false`/,
      );
    } finally {
      await vm.kill();
    }
  });

  it("vm.fork throws SNAPSHOT_NO_DISK when source booted with snapshot:false", async () => {
    // The source can't be CRIU-dumped without a /dev/vda scratch — so
    // fork (which always snapshots) refuses up front. Same shape as
    // vm.snapshot's own NO_DISK guard, just under a different name.
    const vm = await boot({ binary: "/usr/bin/yes", snapshot: false, timeoutMs: 5_000 });
    try {
      await expect(vm.fork()).rejects.toThrow(/has no scratch disk/);
    } finally {
      await vm.kill();
    }
  });

  it("throws when the guest exits without producing a dump", async () => {
    // /usr/bin/true exits immediately, so the VMM comes down cleanly
    // before the in-guest dump script has any chance to run. The host
    // never sees the dump exec return on its own → SNAPSHOT_TIMEOUT
    // (or, if vsock comes down faster than the deadline, a no-bundle
    // SNAPSHOT_DUMP_FAILED). Either is the right "dump never ran"
    // signal; we accept both.
    const snap = `/tmp/machinen-snap-nook-${process.pid}.img`;
    const outDir = `/tmp/machinen-snap-nook-out-${process.pid}`;
    writeFileSync(snap, Buffer.alloc(1024));
    try {
      const vm = await boot({
        binary: "/usr/bin/true",
        snapshot: snap,
        timeoutMs: 5_000,
      });
      await expect(vm.snapshot({ outDir, timeoutMs: 2_000 })).rejects.toThrow(
        /dump exec did not return|dump exec failed|core-\*\.img/,
      );
    } finally {
      try {
        unlinkSync(snap);
      } catch {}
      try {
        rmSync(outDir, { recursive: true, force: true });
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

  it("exec() throws ExecError on non-zero exit and surfaces stderr", async () => {
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
        await expect(vm.exec("doesnt-matter")).rejects.toThrow(ExecError);
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
