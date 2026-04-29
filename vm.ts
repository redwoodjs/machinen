// Boot a machinen microVM from the provisioned ./app.tar.gz with this
// clone's source live-mounted at /mnt/workspace.
//
//   pnpm provision   # one-time, builds ./app.tar.gz (run from canonical)
//   pnpm vm-pick     # CoW-clone for an issue/PR, then auto-boot
//   pnpm vm          # boot from inside an already-prepared clone
//
// vm.ts must run inside a clone — a directory created by `pnpm vm-pick`
// containing a `.machinen-vm/origin` marker that points at the canonical
// checkout. Runtime + release-assets + app.tar.gz all resolve against
// that origin so clones never need to build machinen themselves.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- origin marker: where the canonical machinen checkout lives ---------
const ORIGIN_FILE = join(HERE, ".machinen-vm", "origin");
if (!existsSync(ORIGIN_FILE)) {
  console.error(
    `vm.ts: no .machinen-vm/origin marker at ${HERE}.\n` +
      "       vm.ts must run inside a clone created by `pnpm vm-pick`.\n" +
      "       Run `pnpm vm-pick` from the canonical checkout first.",
  );
  process.exit(1);
}
const MAIN_REPO = readFileSync(ORIGIN_FILE, "utf8").trim();
if (!existsSync(MAIN_REPO)) {
  console.error(`vm.ts: origin marker points at ${MAIN_REPO}, which doesn't exist.`);
  process.exit(1);
}

// Optional issue ref written by vm-pick — when present, the boot
// drops the user straight into `claude "work on #NNN"` instead of a
// bare bash. Reject anything that isn't a bare integer so the value
// can be safely substituted into a shell command.
const ISSUE_FILE = join(HERE, ".machinen-vm", "issue");
let issueNumber = "";
if (existsSync(ISSUE_FILE)) {
  const raw = readFileSync(ISSUE_FILE, "utf8").trim();
  if (/^\d+$/.test(raw)) {
    issueNumber = raw;
  } else if (raw) {
    console.error(`vm.ts: ignoring malformed .machinen-vm/issue contents: ${JSON.stringify(raw)}`);
  }
}

// e2fsprogs is keg-only on Homebrew (its `mkfs.ext4`/`mke2fs` would
// collide with macOS's `newfs_*` family). The runtime now bundles
// mke2fs, but keep the PATH munge as a fallback.
const BREW_E2FS = "/opt/homebrew/opt/e2fsprogs/sbin";
if (existsSync(BREW_E2FS) && !(process.env.PATH ?? "").includes(BREW_E2FS)) {
  process.env.PATH = `${BREW_E2FS}:${process.env.PATH ?? ""}`;
}

// Resolve runtime against the canonical's node_modules — clones don't
// build machinen themselves.
const mainRequire = createRequire(join(MAIN_REPO, "package.json"));
const runtimeEntry = mainRequire.resolve("@machinen/runtime");
type Runtime = typeof import("@machinen/runtime");
// VsockWinsize's constructor is private (callers must use the static
// `connect()` factory), which means `InstanceType<typeof X>` doesn't
// work — TS rejects assigning a private-constructor class to its
// public constructor type. Pull the instance type off the factory's
// return value instead.
type VsockWinsizeHandle = Awaited<ReturnType<Runtime["VsockWinsize"]["connect"]>>;
const { boot, VsockWinsize } = (await import(pathToFileURL(runtimeEntry).href)) as Runtime;

const ASSETS = process.env.MACHINEN_ASSETS_DIR ?? resolve(MAIN_REPO, "release-assets");
const CACHE_DIR = join(homedir(), ".cache", "machinen", basename(MAIN_REPO));
await mkdir(CACHE_DIR, { recursive: true });
const IMAGE = join(CACHE_DIR, "app.tar.gz");

if (!existsSync(IMAGE)) {
  console.error(`vm.ts: ${IMAGE} not found — run \`pnpm provision\` from ${MAIN_REPO} first.`);
  process.exit(1);
}

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

// --- secrets from host --------------------------------------------------
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

const ghToken = readHostCmd("GH_TOKEN", "gh", ["auth", "token"]);

// Claude Code's OAuth blob lives in the macOS Keychain under
// "Claude Code-credentials". -w prints the JSON blob. On the guest,
// /etc/bash.bashrc (staged at provision time) writes it to
// ~/.claude/.credentials.json on first interactive shell, then unsets
// the env var.
const claudeCreds = readHostCmd("Claude Code credentials", "security", [
  "find-generic-password",
  "-s",
  "Claude Code-credentials",
  "-w",
]);

// ~/.claude.json holds the identity slice (userID, oauthAccount,
// hasCompletedOnboarding). Recent claude-code builds refuse to start an
// authenticated session without it, so ship a trimmed copy of the host's
// file on every boot. provision.ts only writes it when ~/.claude.json is
// missing, so VM-accumulated state isn't clobbered.
function readHostClaudeAccount(): string {
  const path = join(homedir(), ".claude.json");
  if (!existsSync(path)) {
    console.error(`vm.ts: ${path} not found — run \`claude\` once on the host to log in.`);
    process.exit(1);
  }
  const full = JSON.parse(readFileSync(path, "utf8"));
  const slice: Record<string, unknown> = {};
  for (const k of [
    "userID",
    "oauthAccount",
    "hasCompletedOnboarding",
    "firstStartTime",
    "anonymousId",
  ]) {
    if (k in full) {
      slice[k] = full[k];
    }
  }
  return JSON.stringify(slice);
}
const claudeAccountJson = readHostClaudeAccount();

// Use MACHINEN_-prefixed names so the OLD baked /etc/profile.d snippet
// in pre-fix images doesn't see them — it consumed `CLAUDE_*` and
// unconditionally `unset CLAUDE_ACCOUNT_JSON` before our bootstrap had
// a chance to read it. With these names, the bootstrap is the only
// thing that touches them.
// Seed the guest TTY size from the host terminal. The bootstrap below
// `stty`'s the kernel TTY for first paint; the VsockWinsize wiring
// after `boot()` propagates host SIGWINCH for the rest of the session
// (#177). The two are complementary — if the agent isn't on the rootfs
// or the vsock connect fails, the stty fallback still gives us a
// correctly-sized tty on first render.
const stdoutAny = process.stdout as NodeJS.WriteStream;
const hostCols = stdoutAny.columns ?? 80;
const hostRows = stdoutAny.rows ?? 24;

// #177: ask the VMM to bridge AF_VSOCK port 1974 (the guest agent's
// listen port) to a host UDS. boot()'s vsock-bridge code parses the
// first `in:` entry to wire vm.exec(); we don't use vm.exec from this
// script, so co-opting that slot for winsize is fine.
const winsizeUdsPath = join(tmpdir(), `machinen-winsize-${process.pid}.sock`);
const secretEnv: Record<string, string> = {
  GH_TOKEN: ghToken,
  GITHUB_TOKEN: ghToken,
  MACHINEN_CLAUDE_CREDENTIALS: claudeCreds,
  MACHINEN_CLAUDE_ACCOUNT_JSON: claudeAccountJson,
  COLUMNS: String(hostCols),
  LINES: String(hostRows),
};

// Bootstrap credentials at boot time (not via /etc/profile.d) so a
// stale `app.tar.gz` doesn't pin us to whatever profile snippet was
// current when the image was last provisioned. Always overwrite — the
// host's keychain + ~/.claude.json are the source of truth, the image
// is not.
// IMPORTANT: this snippet is mirrored byte-for-byte (sans the final
// `exec bash -i`) by scripts/test-claude-bootstrap.mjs, which executes
// it on the host against an isolated $HOME to verify behaviour without
// a 30-second VM boot loop. Keep them in sync.
//
// Older images may have a missing /tmp (pre fix #176) and a missing
// /dev/fd (no proc->fd symlinks staged), so avoid both `mktemp` and
// bash process substitution `<(...)`. Stage everything in $HOME.
const bootstrap = [
  'mkdir -p "$HOME/.claude"',
  'if [ -n "${MACHINEN_CLAUDE_CREDENTIALS:-}" ]; then',
  '  printf "%s" "$MACHINEN_CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"',
  '  chmod 600 "$HOME/.claude/.credentials.json"',
  "fi",
  // If the account env didn't make it through (vm.ts couldn't read the
  // host slice, runtime stripped it, etc.) we MUST NOT write anything
  // to ~/.claude.json — an empty/garbage file there breaks the claude
  // CLI on next launch, which is how this bootstrap regressed before.
  'if [ -n "${MACHINEN_CLAUDE_ACCOUNT_JSON:-}" ]; then',
  '  acct="$HOME/.claude.json.machinen-acct"',
  '  merged="$HOME/.claude.json.machinen-merged"',
  '  printf "%s" "$MACHINEN_CLAUDE_ACCOUNT_JSON" > "$acct"',
  '  if [ -e "$HOME/.claude.json" ] && command -v jq >/dev/null 2>&1 && \\',
  '     jq -e . "$HOME/.claude.json" >/dev/null 2>&1; then',
  '    if jq -s ".[0] * .[1]" "$HOME/.claude.json" "$acct" > "$merged" 2>/dev/null && \\',
  '       [ -s "$merged" ]; then',
  '      mv "$merged" "$HOME/.claude.json"',
  "    else",
  '      rm -f "$merged"',
  '      cp "$acct" "$HOME/.claude.json"',
  "    fi",
  "  else",
  '    cp "$acct" "$HOME/.claude.json"',
  "  fi",
  '  rm -f "$acct"',
  '  chmod 600 "$HOME/.claude.json"',
  "fi",
  "unset MACHINEN_CLAUDE_CREDENTIALS MACHINEN_CLAUDE_ACCOUNT_JSON",
  // Inside the sandbox VM, every claude invocation should run with
  // IS_SANDBOX=1 + --dangerously-skip-permissions. Stage as a shell
  // function in ~/.bashrc.machinen, sourced once from ~/.bashrc. The
  // function uses `command claude` to bypass recursion. Re-written
  // each boot so changes here propagate without manual cleanup.
  'cat > "$HOME/.bashrc.machinen" <<\\EOF',
  "claude() {",
  '  IS_SANDBOX=1 command claude --dangerously-skip-permissions "$@"',
  "}",
  "EOF",
  'if ! grep -q ".bashrc.machinen" "$HOME/.bashrc" 2>/dev/null; then',
  '  printf "\\n[ -f \\"\\$HOME/.bashrc.machinen\\" ] && . \\"\\$HOME/.bashrc.machinen\\"\\n" >> "$HOME/.bashrc"',
  "fi",
  // Apply COLUMNS/LINES from vm.ts to the kernel TTY so TUIs see the
  // host terminal's real dimensions on first paint. Failure (no tty,
  // bad size) is silent — bash will fall back to its 80x24 default.
  'if [ -n "${COLUMNS:-}" ] && [ -n "${LINES:-}" ]; then',
  '  stty cols "$COLUMNS" rows "$LINES" 2>/dev/null || true',
  "fi",
  // #177: launch the vsock TIOCSWINSZ agent so subsequent host
  // SIGWINCH (forwarded by VsockWinsize below) resize the guest tty
  // mid-session. Backgrounded + reparented to PID 1 once `exec bash -i`
  // replaces this shell. /dev/null redirects so the agent's "applied:"
  // log lines don't smear over the user's terminal. No-op if the
  // binary is missing (stale rootfs); the host-side connect will
  // time out and fall back to the stty-on-boot behavior above.
  "if [ -x /sbin/machinen-winsize-agent ]; then",
  "  /sbin/machinen-winsize-agent </dev/null >/dev/null 2>&1 &",
  "fi",
  "cd /mnt/workspace 2>/dev/null",
  // When vm-pick stamped an issue ref, hand the host TTY directly to
  // claude — exec replaces the bootstrap shell so claude is the
  // foreground process the user is interacting with, not a child of
  // bash. The IS_SANDBOX/--dangerously-skip-permissions pair mirrors
  // the bashrc.machinen `claude` function (functions don't survive
  // exec, so inline them). When claude exits, the bootstrap ends and
  // the VM powers off.
  issueNumber
    ? `exec env IS_SANDBOX=1 claude --dangerously-skip-permissions "work on #${issueNumber}"`
    : "exec bash -i",
].join("\n");

const vm = await boot({
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  image: IMAGE,
  liveMounts: [{ host: HERE, guest: "/mnt/workspace", mode: "rw" }],
  cmd: ["/bin/bash", "-lc", bootstrap],
  env: secretEnv,
  vmmEnv: {
    MACHINEN_RAM_BYTES: String(ramForImage(IMAGE)),
    MACHINEN_VSOCK: `in:1974:${winsizeUdsPath}`,
  },
  timeoutMs: null,
});

// #177: connect to the in-guest winsize-agent and forward host
// SIGWINCH for the rest of the session. Non-fatal: a stale rootfs
// without /sbin/machinen-winsize-agent leaves nothing listening on
// vsock 1974, so the connect retries inside VsockWinsize will give up
// after ~10s. We catch and continue — the stty-on-bootstrap path
// already handled first paint, only mid-session resizes are lost.
let winsize: VsockWinsizeHandle | undefined;
try {
  winsize = await VsockWinsize.connect(winsizeUdsPath, { timeoutMs: 10_000 });
  winsize.send(hostCols, hostRows);
  process.stdout.on("resize", () => {
    if (!winsize) {
      return;
    }
    const cols = stdoutAny.columns ?? hostCols;
    const rows = stdoutAny.rows ?? hostRows;
    winsize.send(cols, rows);
  });
} catch (err) {
  process.stderr.write(
    `[machinen] winsize forwarding unavailable (${err instanceof Error ? err.message : String(err)}) — host resizes won't reach the guest tty\n`,
  );
}

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

const { code } = await vm.wait();
winsize?.close();
if (isTty) {
  stdin.setRawMode!(false);
  // RIS (full terminal reset) + clear scrollback + home cursor, so the
  // host shell starts fresh after `exit`. No-op when stdout isn't a TTY.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1bc\x1b[3J\x1b[H");
  }
}
process.exit(code ?? 0);
