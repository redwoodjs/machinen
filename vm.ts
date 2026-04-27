// Boot a machinen microVM from the provisioned ./app.tar.gz with this
// directory live-mounted at /mnt/workspace, drop into bash, and (if
// configured) run a background bootstrap command. Run with:
//
//   pnpm provision   # one-time, builds ./app.tar.gz with bash+node+pnpm
//   pnpm vm          # boots from app.tar.gz
//
// Set DEV_CMD below (or MACHINEN_DEV_CMD env) to run a command in
// parallel with bash. By default we just `pnpm install` the mounted
// workspace once on boot. Output is teed to ./dev.log on the host so
// it doesn't garble the interactive shell. Tail it from another
// terminal:
//
//   tail -f dev.log
//
// Ctrl-C reaches bash's foreground program; Ctrl-D powers off the VM
// (which also kills the background command cleanly).

import { boot } from "@machinen/runtime";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// e2fsprogs is keg-only on Homebrew (its `mkfs.ext4`/`mke2fs` would
// collide with macOS's `newfs_*` family) — its binaries live under
// /opt/homebrew/opt/e2fsprogs/sbin/. The runtime's ensureRootfsImage
// shells out to `mke2fs` to format the rootfs `.img`, so we prepend
// the keg-only path. Harmless on Linux / when the dir doesn't exist.
const BREW_E2FS = "/opt/homebrew/opt/e2fsprogs/sbin";
if (existsSync(BREW_E2FS) && !(process.env.PATH ?? "").includes(BREW_E2FS)) {
  process.env.PATH = `${BREW_E2FS}:${process.env.PATH ?? ""}`;
}

// Resolve @machinen/runtime to find the monorepo checkout, then walk up
// to its release-assets/. Works regardless of where this script lives,
// as long as @machinen/runtime is `pnpm link`'d at this consumer.
//   .../machinen/packages/runtime/dist/index.js
//   → dirname × 3 (dist → runtime → packages → machinen)
//   → release-assets
const require = createRequire(import.meta.url);
const runtimeEntry = require.resolve("@machinen/runtime");
const ASSETS =
  process.env.MACHINEN_ASSETS_DIR ??
  resolve(dirname(runtimeEntry), "..", "..", "..", "release-assets");

const HERE = dirname(fileURLToPath(import.meta.url));

// Build artifacts (the provisioned rootfs, the dev-cmd log) live OUTSIDE
// the project dir so they're not dragged into the guest's initramfs by
// the copy-once mount of HERE → /mnt/workspace. Keeping them in the
// project would mean every boot packs a copy of app.tar.gz inside the
// rootfs that's about to be unpacked from app.tar.gz — recursion-shaped
// and trips the kernel's initramfs unpack ceiling once the rootfs gets
// big enough. ~/.cache is the standard host-side spillover dir.
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(HERE));
mkdirSync(CACHE_DIR, { recursive: true });
const IMAGE = join(CACHE_DIR, "app.tar.gz");
const DEV_LOG = join(CACHE_DIR, "dev.log");

if (!existsSync(IMAGE)) {
  console.error(`vm.ts: ${IMAGE} not found — run \`pnpm provision\` first.`);
  process.exit(1);
}

// Pick a RAM size from the gzipped rootfs tarball size — see
// provision.ts for the formula derivation. Same numbers there.
function ramForImage(path: string): number {
  const compressed = statSync(path).size;
  const GIB = 1024 * 1024 * 1024;
  const raw = Math.max(4 * GIB, compressed * 16 + 2 * GIB);
  const align = 256 * 1024 * 1024;
  return Math.ceil(raw / align) * align;
}
process.stderr.write(
  `[machinen] ram=${(ramForImage(IMAGE) / 1024 ** 3).toFixed(1)} GiB ` +
    `(image=${(statSync(IMAGE).size / 1024 ** 2).toFixed(0)} MB)\n`,
);

// Pull secrets from the host before boot and inject them into the
// guest's env. The host's `op` / `gh` CLIs handle all auth (biometric
// / SSO) — the guest gets the resolved values as env vars, while also
// having its own `op` / `gh` binaries available from provision.ts.
//
// Secrets are NOT baked into app.tar.gz at provision time — they're
// injected per-boot here. That keeps the rootfs free of credentials
// and lets you rotate without rebuilding.
function readHostCmd(label: string, file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error(`vm.ts: failed to read ${label}: ${msg}`);
    console.error(`            (cmd: ${file} ${args.join(" ")})`);
    process.exit(1);
  }
}

const secretEnv: Record<string, string> = {
  CHEAPEST_INFERENCE_API_KEY: readHostCmd("CHEAPEST_INFERENCE_API_KEY", "op", [
    "read",
    "op://RedwoodJS/cheapestinference/credential",
  ]),
  GITHUB_TOKEN: readHostCmd("GITHUB_TOKEN", "gh", ["auth", "token"]),
};

const vm = await boot({
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  image: IMAGE,
  // cmd + env are baked into app.tar.gz by provision(); they default
  // to bash + a friendly PS1. Override here only if you want something
  // different at run time.
  // Copy-once mount: snapshots the host dir into the guest at boot.
  // Edits on the host AFTER boot are not visible until reboot.
  // (Switch back to `liveMounts: [...]` once redwoodjs/machinen#113
  // — the FUSE host-server hang on first request — is fixed.)
  // /init carries /mnt across the rootdisk pivot now (#126), so this
  // works with the rootDisk-by-default path.
  mount: { host: HERE, guest: "/mnt/workspace" },
  // Vite's default; change to whatever your app listens on.
  portForward: [{ hostPort: 5173, guestPort: 5173 }],
  // Layered on top of the env baked into app.tar.gz by provision()
  // (PATH/HOME/PS1). Caller's env wins on key collision.
  env: secretEnv,
  // Auto-size guest RAM from the rootfs's gzipped tarball size — see
  // ramForImage() below. The kernel uses initramfs-as-rootfs, so the
  // RAM footprint scales with the rootfs.
  vmmEnv: { MACHINEN_RAM_BYTES: String(ramForImage(IMAGE)) },
  // Interactive — don't apply the default 60s ceiling.
  timeoutMs: null,
});

// Raw-mode TTY plumbing: Ctrl-C / Ctrl-D flow through to the guest's
// foreground program instead of being eaten by the host kernel.
const stdin = process.stdin as NodeJS.ReadStream & {
  setRawMode?: (m: boolean) => void;
};
const isTty = stdin.isTTY === true && typeof stdin.setRawMode === "function";
if (isTty) {
  stdin.setRawMode!(true);
}

vm.stdout.pipe(process.stdout);
vm.stderr.pipe(process.stderr);
process.stdin.pipe(vm.stdin);

// Optionally run a background command alongside bash. Spawned via the
// exec-agent (vsock port 1978) — a sibling process to bash, not a child
// of it. Output is teed to ./dev.log on the host so the interactive
// shell stays readable.
//
// We don't await this — execRaw resolves only when the command exits.
// Letting it settle in the background means bash gets the foreground
// and /sbin/machinen-poweroff still fires when bash exits.
const DEV_CMD = process.env.MACHINEN_DEV_CMD ?? "cd /mnt/workspace && pnpm install";
if (DEV_CMD) {
  const log = createWriteStream(DEV_LOG, { flags: "w" });
  log.write(`# machinen dev: ${DEV_CMD}\n# started at ${new Date().toISOString()}\n\n`);
  process.stderr.write(`[machinen] dev cmd "${DEV_CMD}" → ${DEV_LOG}\n`);
  void vm
    .execRaw(DEV_CMD, {
      onStdout: (chunk) => log.write(chunk),
      onStderr: (chunk) => log.write(chunk),
    })
    .catch((err) => {
      // Background cmd died (or VM shut down). Log to host stderr but
      // don't tear bash down — the user might still want the shell.
      log.write(`\n# dev cmd ended: ${err}\n`);
    });
}

const { code } = await vm.wait();
if (isTty) {
  stdin.setRawMode!(false);
}
process.exit(code ?? 0);
