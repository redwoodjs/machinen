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

// --- benchmarks ---------------------------------------------------------
//
// Permanent step-level timings. `bench(label, fn)` logs start/done
// lines so the user sees what stage we're in (also surfaces in the
// Claude Code sidebar). Runtime-side phase events from boot() get
// rendered into a one-shot breakdown block once `boot()` returns —
// see #233.
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`);
async function bench<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  process.stderr.write(`[machinen] ${label}...\n`);
  try {
    const result = await fn();
    process.stderr.write(`[machinen] ${label} (${fmtMs(performance.now() - start)})\n`);
    return result;
  } catch (err) {
    process.stderr.write(`[machinen] ${label} FAILED (${fmtMs(performance.now() - start)})\n`);
    throw err;
  }
}

function renderPhaseBlock(evt: import("@machinen/runtime").PhaseLogEvent): void {
  const labelW = phaseLabelWidth(evt, 20);
  process.stderr.write(`[machinen] === ${evt.kind} phases (total ${fmtMs(evt.totalMs)}) ===\n`);
  renderPhaseRows(evt, labelW);
  renderUnattributedPhase(evt, labelW);
}

function phaseLabelWidth(evt: import("@machinen/runtime").PhaseLogEvent, min: number): number {
  const widths = [...evt.phases.keys()].map((name) => name.length + subPhaseIndent(name).length);
  return Math.max(min, ...widths);
}

function renderPhaseRows(evt: import("@machinen/runtime").PhaseLogEvent, labelW: number): void {
  for (const [name, ms] of evt.phases) {
    writePhaseRow(phaseDisplayName(name), ms, evt.totalMs, labelW);
  }
}

function renderUnattributedPhase(
  evt: import("@machinen/runtime").PhaseLogEvent,
  labelW: number,
): void {
  const other = Math.max(0, evt.totalMs - topLevelPhaseSum(evt));
  if (other > 0 && evt.totalMs > 0) {
    writePhaseRow("(unattributed)", other, evt.totalMs, labelW);
  }
}

function topLevelPhaseSum(evt: import("@machinen/runtime").PhaseLogEvent): number {
  let sum = 0;
  for (const [name, ms] of evt.phases) {
    sum += isSubPhase(name) ? 0 : ms;
  }
  return sum;
}

function writePhaseRow(label: string, ms: number, total: number, labelW: number): void {
  process.stderr.write(
    `[machinen]   ${label.padEnd(labelW)} ${fmtMs(ms).padStart(8)}  ${phasePercent(ms, total)}%\n`,
  );
}

function phaseDisplayName(name: string): string {
  return `${subPhaseIndent(name)}${name}`;
}

function subPhaseIndent(name: string): string {
  return isSubPhase(name) ? "  " : "";
}

function isSubPhase(name: string): boolean {
  return name.includes(".");
}

function phasePercent(ms: number, total: number): string {
  return total > 0 ? ((ms / total) * 100).toFixed(0).padStart(3) : "  -";
}

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

const ghToken = await bench("read gh token", () =>
  readHostCmd("GH_TOKEN", "gh", ["auth", "token"]));

// Claude Code's OAuth blob lives in the macOS Keychain under
// "Claude Code-credentials". -w prints the JSON blob. On the guest,
// /etc/bash.bashrc (staged at provision time) writes it to
// ~/.claude/.credentials.json on first interactive shell, then unsets
// the env var.
const claudeCreds = await bench("read claude creds", () =>
  readHostCmd("Claude Code credentials", "security", [
    "find-generic-password",
    "-s",
    "Claude Code-credentials",
    "-w",
  ]));

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
const claudeAccountJson = await bench("read claude account", () => readHostClaudeAccount());

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

// #177: ask the VMM to bridge AF_VSOCK port 1974 (winsize agent) to a
// host UDS. We ALSO wire up port 1978 (exec-agent) so `machinen exec
// <pid>` and `machinen snapshot <pid> <out-dir>` work against this VM —
// the runtime's registry stores the FIRST entry's UDS as the socket
// path attach handles use, so put exec first and winsize second.
// Without this the registered socketPath was the winsize UDS, which
// doesn't speak the exec protocol, and any exec/snapshot stalled until
// timeout with zero output.
const execUdsPath = join(tmpdir(), `machinen-exec-${process.pid}.sock`);
const winsizeUdsPath = join(tmpdir(), `machinen-winsize-${process.pid}.sock`);
const secretEnv: Record<string, string> = {
  GH_TOKEN: ghToken,
  GITHUB_TOKEN: ghToken,
  MACHINEN_CLAUDE_CREDENTIALS: claudeCreds,
  MACHINEN_CLAUDE_ACCOUNT_JSON: claudeAccountJson,
  COLUMNS: String(hostCols),
  LINES: String(hostRows),
  // The bootstrap below stages credentials into $HOME and then drops
  // privileges to the `dev` user (uid 501, provisioned by provision.ts
  // in install hooks). Setting HOME up front targets dev's home for the
  // staging step, so a single chown -R hands everything off cleanly.
  HOME: "/home/dev",
};

// Bootstrap credentials at boot time (not via /etc/profile.d) so a
// stale `app.tar.gz` doesn't pin us to whatever profile snippet was
// current when the image was last provisioned. Always overwrite — the
// host's keychain + ~/.claude.json are the source of truth, the image
// is not.
//
// Two-stage: STAGE_BOOTSTRAP runs as root with HOME=/home/dev (set in
// secretEnv) and writes credentials/bashrc into the dev user's home.
// DEV_BOOTSTRAP runs after a chown + uid switch via runuser, and
// handles tty setup, the winsize agent, and the final exec.
//
// IMPORTANT: STAGE_BOOTSTRAP is mirrored byte-for-byte by
// scripts/test-claude-bootstrap.mjs, which executes it on the host
// against an isolated $HOME to verify behaviour without a 30-second VM
// boot loop. Keep them in sync.
//
// Older images may have a missing /tmp (pre fix #176) and a missing
// /dev/fd (no proc->fd symlinks staged), so avoid both `mktemp` and
// bash process substitution `<(...)`. Stage everything in $HOME.
const STAGE_BOOTSTRAP = [
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
  // ~/.bashrc.machinen: claude wrapper + auto-cd into /mnt/workspace.
  // The auto-cd lives in bashrc rather than the dev bootstrap so the
  // EXEC'd workload's CWD stays at /home/dev (always exists in the
  // rootfs). Snapshotting a workload whose CWD points at the live FUSE
  // bind mount /mnt/workspace makes restore fail with "Can't open cwd"
  // because that path doesn't exist on the restored VM (no live mount
  // is re-attached on restore). Keeping the workload's CWD at /home/dev
  // and pushing the convenience cd into interactive shells means
  // snapshot/restore round-trips cleanly while the user still lands in
  // the workspace dir on every new shell.
  'cat > "$HOME/.bashrc.machinen" <<\\EOF',
  "claude() {",
  '  IS_SANDBOX=1 command claude --dangerously-skip-permissions "$@"',
  "}",
  'if [ -d /mnt/workspace ] && [ "$PWD" = "$HOME" ]; then',
  "  cd /mnt/workspace",
  "fi",
  "EOF",
  'if ! grep -q ".bashrc.machinen" "$HOME/.bashrc" 2>/dev/null; then',
  '  printf "\\n[ -f \\"\\$HOME/.bashrc.machinen\\" ] && . \\"\\$HOME/.bashrc.machinen\\"\\n" >> "$HOME/.bashrc"',
  "fi",
];

// Dev-side bootstrap. Runs as uid 501 (the `dev` user) after the
// chown + runuser handoff. issueNumber-aware exec mirrors the previous
// flow: when vm-pick stamped an issue ref, exec straight into claude
// so it owns the host TTY (functions don't survive exec, so inline the
// IS_SANDBOX/--dangerously-skip-permissions pair). Otherwise drop into
// an interactive bash, which sources ~/.bashrc.machinen for the
// `claude` wrapper.
const DEV_BOOTSTRAP = [
  // Apply COLUMNS/LINES to the kernel TTY for first-paint sizing (#177's
  // VsockWinsize handles mid-session resizes). Silent on failure.
  'if [ -n "${COLUMNS:-}" ] && [ -n "${LINES:-}" ]; then',
  '  stty cols "$COLUMNS" rows "$LINES" 2>/dev/null || true',
  "fi",
  // #177 vsock TIOCSWINSZ agent is now spawned by /sbin/machinen-supervisor
  // as a SIBLING of the workload (alongside /exec-agent), so its
  // AF_VSOCK fd never appears inside the dumpable workload tree.
  // Putting the spawn here used to make the agent a workload descendant,
  // which broke `criu dump` ("BUG! Unknown socket collected (family 40)")
  // and made `machinen snapshot X <out-dir>` fail on every vm-pick'd VM.
  // CWD stays at /home/dev (set by env above) so snapshot/restore can
  // re-open it on the restored VM. ~/.bashrc.machinen handles the
  // convenience cd into /mnt/workspace for interactive shells — see the
  // STAGE_BOOTSTRAP block where that bashrc snippet is staged.
  issueNumber
    ? `cd /mnt/workspace 2>/dev/null; exec env IS_SANDBOX=1 claude --dangerously-skip-permissions "work on #${issueNumber}"`
    : "exec bash -i",
].join("\n");
const DEV_BOOTSTRAP_B64 = Buffer.from(DEV_BOOTSTRAP).toString("base64");

const bootstrap = [
  ...STAGE_BOOTSTRAP,
  // Stage the dev-side bootstrap into $HOME (NOT /tmp — older images
  // may not have /tmp, see the STAGE_BOOTSTRAP comment above). Base64
  // sidesteps the quoting headache of nesting a multi-line shell
  // snippet inside the outer runuser invocation. Stage BEFORE the
  // chown so dev inherits ownership in one pass.
  `echo ${DEV_BOOTSTRAP_B64} | base64 -d > "$HOME/.machinen-dev-bootstrap.sh"`,
  'chmod 755 "$HOME/.machinen-dev-bootstrap.sh"',
  // Hand the staged files off to dev. Cheap because /home/dev is
  // small (creds + bashrc + dev-bootstrap files only).
  'chown -R dev:dev "$HOME"',
  // Drop privs to dev with a controlled env. `env -i` clears the
  // inherited env (including MACHINEN_* leftovers) and we forward only
  // what dev needs. `runuser -m` preserves the env we just built across
  // the uid switch (without -m it would reset HOME/USER/etc.).
  // PATH includes /usr/local/bin where node/pnpm/claude live as symlinks.
  "exec env -i " +
    "HOME=/home/dev USER=dev LOGNAME=dev SHELL=/bin/bash " +
    'TERM="${TERM:-xterm-256color}" ' +
    'COLUMNS="${COLUMNS:-80}" LINES="${LINES:-24}" ' +
    'GH_TOKEN="${GH_TOKEN:-}" GITHUB_TOKEN="${GITHUB_TOKEN:-}" ' +
    "PATH=/usr/local/bin:/usr/bin:/bin:/sbin " +
    "runuser -m -u dev -- bash /home/dev/.machinen-dev-bootstrap.sh",
].join("\n");

const vm = await bench("vm boot", () =>
  boot({
    kernel: join(ASSETS, "Image-arm64"),
    dtb: join(ASSETS, "virt-arm64.dtb"),
    image: IMAGE,
    liveMounts: [{ host: HERE, guest: "/mnt/workspace", mode: "rw" }],
    cmd: ["/bin/bash", "-lc", bootstrap],
    env: secretEnv,
    vmmEnv: {
      MACHINEN_RAM_BYTES: String(ramForImage(IMAGE)),
      MACHINEN_VSOCK: `in:1978:${execUdsPath},in:1974:${winsizeUdsPath}`,
    },
    timeoutMs: null,
    // Surface the runtime's per-phase boot timeline (#233). Prints
    // once when the VMM's first stderr byte arrives — fits the "show
    // what the boot is doing" sidebar slot. Console bytes still flow
    // through the stdout/stderr pipes wired below, so we don't need
    // to forward chunk events here.
    onLog: (evt) => {
      if (evt.source === "phase") {
        renderPhaseBlock(evt);
      }
    },
  }));

// Wire host <-> guest stdio FIRST. Anything that blocks before this
// (e.g. the winsize connect below) eats kernel boot output and any
// errors a fast-exiting bootstrap prints — making a failed boot look
// like a silent "didn't boot, console clear" mystery.
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

// #177: connect to the in-guest winsize-agent and forward host
// SIGWINCH for the rest of the session. Non-fatal: a stale rootfs
// without /sbin/machinen-winsize-agent leaves nothing listening on
// vsock 1974, so the connect retries inside VsockWinsize will give up
// after ~10s. We catch and continue — the stty-on-bootstrap path
// already handled first paint, only mid-session resizes are lost.
// Run in the background so the connect's 10s ceiling never delays
// stdio piping (see the block above).
let winsize: VsockWinsizeHandle | undefined;
const winsizeReady = (async () => {
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
})();

const { code } = await vm.wait();
await winsizeReady;
winsize?.close();
if (isTty) {
  stdin.setRawMode!(false);
  // Terminal-reset on exit (`\x1bc\x1b[3J\x1b[H`) used to run here so
  // the host shell felt fresh after the agent loop finished. It's
  // user-hostile during debugging — a failed boot, or a session that
  // exits faster than the user can read, leaves nothing on screen.
  // Opt-in via MACHINEN_VM_CLEAR_ON_EXIT=1 if the old behavior is wanted.
  if (process.stdout.isTTY && process.env.MACHINEN_VM_CLEAR_ON_EXIT === "1") {
    process.stdout.write("\x1bc\x1b[3J\x1b[H");
  }
}
process.stderr.write(`[machinen] vm exited with code ${code ?? 0}\n`);
process.exit(code ?? 0);
