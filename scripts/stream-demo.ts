// Demo: wire `onLog` into every runtime API and print each LogEvent.
//
// Run:
//   MACHINEN_ASSETS_DIR=./release-assets \
//   MACHINEN_VMM=$(find packages/microvm/.zig-cache/o -name test -type f \
//                    -exec bash -c 'strings "$1" | grep -q MACHINEN_BOOT_TEST && echo "$1"' _ {} \; | head -1) \
//   npx tsx scripts/stream-demo.ts
//
// Needs:
//   - A built VMM binary (packages/microvm: `zig build test`)
//   - Base assets (release-assets/{Image-arm64,virt-arm64.dtb,rootfs-debian-arm64.tar.gz})
//     produced by scripts/build-base-assets.sh.
//
// Prints every LogEvent as `[api][source cmd?] <bytes>` so the streaming
// behavior is visible per-API: provision, boot, exec, snapshot, attach.

import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  attach,
  boot,
  provision,
  type LogEvent,
  type VmHandle,
} from "../packages/runtime/src/index.ts";

const assetsDir = process.env.MACHINEN_ASSETS_DIR;
if (!assetsDir) {
  process.stderr.write("error: set MACHINEN_ASSETS_DIR to a dir with rootfs/Image/dtb\n");
  process.exit(1);
}

const kernel = resolve(assetsDir, "Image-arm64");
const dtb = resolve(assetsDir, "virt-arm64.dtb");

// The VMM test binary hardcodes kernel_path = "test-fixtures/Image",
// dtb_path = "test-fixtures/virt.dtb", initrd_fixture = "test-fixtures/
// initramfs.cpio" relative to its cwd (see boot_hvf.zig). Without those
// files present the boot test silently skips and the VMM exits,
// starving every vsock call of an agent. Stage them as symlinks to
// whatever release-assets has; the runtime still passes its own
// kernel/dtb/initrd via env at boot time, so what's in test-fixtures/
// only needs to satisfy the existence check.
const microvmRoot = resolve(import.meta.dirname, "..", "packages", "microvm");
const fixturesDir = join(microvmRoot, "test-fixtures");
function stageFixture(src: string, dest: string) {
  if (existsSync(dest)) {
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(src, dest);
}
stageFixture(kernel, join(fixturesDir, "Image"));
stageFixture(dtb, join(fixturesDir, "virt.dtb"));
// initramfs.cpio just needs to exist for fixturesPresent(). The runtime
// overrides it via MACHINEN_INITRD per boot. An empty file works.
const dummyInitrd = join(fixturesDir, "initramfs.cpio");
if (!existsSync(dummyInitrd)) {
  mkdirSync(fixturesDir, { recursive: true });
  closeSync(openSync(dummyInitrd, "w"));
}

const workDir = mkdtempSync(join(tmpdir(), "machinen-stream-demo-"));
const warmImage = join(workDir, "warm.tar.gz");
const scratchSnap = join(workDir, "scratch.img");
const savedSnapDir = join(workDir, "saved");

/**
 * Build a printer that buffers bytes per-source-key and flushes one
 * prefixed line per newline. The PL011 emits single-byte frames
 * (`p`, `r`, `i`, `n`…) so prefixing each chunk literally is noisy;
 * buffering makes the same stream readable without losing the
 * source/command tags.
 */
function printer(api: string) {
  const buffers = new Map<string, string>();
  return (evt: LogEvent) => {
    const prefix = evt.cmd ? `[${api}][${evt.source} ${evt.cmd}]` : `[${api}][${evt.source}]`;
    const key = `${evt.source}|${evt.cmd ?? ""}`;
    let pending = (buffers.get(key) ?? "") + evt.chunk.toString("utf8");
    for (;;) {
      const nl = pending.indexOf("\n");
      if (nl === -1) {
        break;
      }
      process.stdout.write(`${prefix} ${pending.slice(0, nl)}\n`);
      pending = pending.slice(nl + 1);
    }
    buffers.set(key, pending);
  };
}

// The Zig test binary gates actual boot behavior on MACHINEN_BOOT_TEST.
// Without it, the binary runs its own trivial self-test ("1/1 main.test…
// OK") and exits without ever booting a guest, so vsock exec times out.
// The integration tests (packages/runtime/src/__tests__/*.test.ts) set
// the same flag; mirror it here.
const sharedVmmEnv = { MACHINEN_BOOT_TEST: "1" };

try {
  process.stdout.write("\n=== provision ===\n");
  await provision({
    cwd: microvmRoot,
    kernel,
    dtb,
    vmmEnv: sharedVmmEnv,
    install: async (vm: VmHandle) => {
      await vm.exec("echo 'install-hook: hello' && uname -m");
    },
    cmd: ["/exec-agent"],
    env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin" },
    out: warmImage,
    onLog: printer("provision"),
  });

  // `snapshot: <path>` on boot() is "attach this file as /dev/vda".
  // vm.snapshot() later writes a CRIU dump into that disk, then copies
  // it to the caller's outPath. Allocate a 1 GiB sparse scratch so the
  // disk exists before boot() validates it.
  const fd = openSync(scratchSnap, "w");
  writeSync(fd, Buffer.alloc(1), 0, 1, 1024 * 1024 * 1024 - 1);
  closeSync(fd);

  process.stdout.write("\n=== boot + exec (streaming long-ish output) ===\n");
  const vm = await boot({
    cwd: microvmRoot,
    image: warmImage,
    kernel,
    dtb,
    vmmEnv: sharedVmmEnv,
    name: "stream-demo",
    snapshot: scratchSnap,
    timeoutMs: null,
    onLog: printer("boot"),
  });

  try {
    // The payload proves streaming: "early" arrives, then a 2s gap,
    // then "late" — watch the timestamps of the boot[exec-stdout]
    // lines below.
    await vm.exec("echo early; sleep 2; echo late");

    process.stdout.write("\n=== attach (from another 'process') ===\n");
    const alt = await attach({ name: "stream-demo", onLog: printer("attach") });
    await alt.execRaw("echo from-attached");
    await alt.detach();

    process.stdout.write("\n=== snapshot ===\n");
    await vm
      .snapshot({ outDir: savedSnapDir, onLog: printer("snapshot") })
      .catch((err: unknown) => {
        // Demo is best-effort: surface the failure but don't abort.
        process.stderr.write(
          `snapshot skipped: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}\n`,
        );
      });
  } finally {
    await vm.kill();
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
