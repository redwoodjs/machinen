#!/usr/bin/env node
/** Reuse or build Machinen Desktop on the mini, then relaunch the relevant app. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const MINI_REPO = process.env.MACHINEN_MINI_REPO ?? "/Users/p4p8/gh/redwoodjs/machinen";
const DESKTOP_DIR = join(MINI_REPO, "apps/machinen-desktop");
const ARTIFACT = join(DESKTOP_DIR, "Machinen.app");
const MINI_DEFAULT_BUNDLE = ARTIFACT;
const AIR_DEFAULT_BUNDLE =
  process.env.MACHINEN_AIR_BUNDLE ??
  "/Users/peterp/gh/redwoodjs/machinen/apps/machinen-desktop/Machinen.app";
const STATE_DIR =
  process.env.MACHINEN_DESKTOP_BUILD_STATE ?? "/Users/p4p8/.local/state/machinen-desktop-rebuild";
const BUILDS_DIR = join(STATE_DIR, "builds");
const HISTORY_PATH = join(STATE_DIR, "history.json");
const AIR_HOST = process.env.MACHINEN_AIR_HOST ?? "air";
const BUNDLE_ID = "dev.machinen.desktop.prototype";
const CACHE_FORMAT = "machinen-desktop-source-v1";
const RETAINED_BUILD_COUNT = 5;
const SSH_BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-T"] as const;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_HELPER = resolve(SCRIPT_DIR, "machinen-api.ts");

type Machine = "mini" | "air";
type Configuration = "debug" | "release";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface AppProcess {
  pid: number;
  bundle: string;
}

interface Target {
  machine: Machine;
  bundle: string;
  reason: string;
}

interface SourceState {
  configuration: Configuration;
  fingerprint: string;
  gitHead: string;
  branch: string;
  dirty: boolean;
  buildId: string;
}

interface BundleInfo {
  version: string;
  build: string;
  cdhash: string;
}

interface BuildArtifact {
  buildId: string;
  path: string;
  info: BundleInfo;
  builtAt: string;
  reused: boolean;
}

interface History {
  version: 1;
  builds: Array<Record<string, unknown>>;
  relaunches: Array<Record<string, unknown>>;
}

class RebuildError extends Error {}

function utcNow(): string {
  return new Date().toISOString();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function run(
  command: string,
  args: readonly string[] = [],
  options: { capture?: boolean; cwd?: string; check?: boolean } = {},
): RunResult {
  const capture = options.capture ?? false;
  const completed = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
  });
  if (completed.error) {throw completed.error;}
  const status = completed.status ?? 1;
  const stdout = capture ? (completed.stdout ?? "") : "";
  const stderr = capture ? (completed.stderr ?? "") : "";
  if ((options.check ?? true) && status !== 0) {
    const detail = (stderr || stdout).trim();
    throw new RebuildError(
      `Command failed (${status}): ${commandText(command, args)}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { status, stdout, stderr };
}

function hostRun(
  machine: Machine,
  command: string,
  args: readonly string[] = [],
  options: { capture?: boolean; check?: boolean } = {},
): RunResult {
  if (machine === "mini") {return run(command, args, options);}
  return run("/usr/bin/ssh", [...SSH_BASE, AIR_HOST, commandText(command, args)], options);
}

function ensureMiniCheckout(): void {
  if (!existsSync(join(MINI_REPO, ".git")) || !existsSync(DESKTOP_DIR)) {
    throw new RebuildError(
      `This coordinator must run on the mini, where the source checkout is ${MINI_REPO}.`,
    );
  }
  if (!existsSync(API_HELPER)) {
    throw new RebuildError(`Machinen Desktop API helper is missing: ${API_HELPER}`);
  }
}

function sessionTerminalId(): string | undefined {
  let pid = process.ppid;
  const seen = new Set<number>();
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const result = run("/bin/ps", ["-p", String(pid), "-o", "ppid=", "-o", "command="], {
      capture: true,
      check: false,
    });
    const line = result.stdout.trim();
    const match = line.match(/^\s*(\d+)\s+([\s\S]*)$/);
    if (!match) {break;}
    const command = match[2];
    if (command.includes("machinen-session") && ` ${command} `.includes(" new ")) {
      const id = command.match(/(?:^|\s)--id(?:\s+|=)([^\s]+)/)?.[1];
      if (id) {return id;}
    }
    pid = Number(match[1]);
  }
  return undefined;
}

function snapshot(machine: Machine): Record<string, unknown> | undefined {
  const result = run(
    process.execPath,
    [
      API_HELPER,
      "--host",
      machine === "mini" ? "local" : AIR_HOST,
      "--timeout",
      "2",
      "system.snapshot",
    ],
    { capture: true, check: false },
  );
  if (result.status !== 0) {return undefined;}
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function snapshotHasTerminal(
  value: Record<string, unknown> | undefined,
  terminalId: string,
): boolean {
  if (!value || !Array.isArray(value.terminals)) {return false;}
  return value.terminals.some(
    (terminal) =>
      terminal &&
      typeof terminal === "object" &&
      (terminal as Record<string, unknown>).id === terminalId,
  );
}

function pathIsProjectBundle(bundle: string): boolean {
  const normalized = bundle.replaceAll("\\", "/");
  return (
    normalized.endsWith("/apps/machinen-desktop/Machinen.app") &&
    normalized.includes("/gh/redwoodjs/")
  );
}

function bundleIdentifier(machine: Machine, bundle: string): string | undefined {
  const result = hostRun(
    machine,
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", join(bundle, "Contents/Info.plist")],
    { capture: true, check: false },
  );
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function projectAppProcesses(machine: Machine): AppProcess[] {
  const script = String.raw`
for pid in $(/usr/bin/pgrep -x Machinen 2>/dev/null || true); do
  command=$(/bin/ps -p "$pid" -o command=)
  /usr/bin/printf '%s\t%s\n' "$pid" "$command"
done
`;
  const result = hostRun(machine, "/bin/bash", ["-c", script], {
    capture: true,
  });
  const processes: AppProcess[] = [];
  for (const line of result.stdout.split("\n")) {
    const separator = line.indexOf("\t");
    if (separator < 1) {continue;}
    const pid = Number(line.slice(0, separator));
    const command = line.slice(separator + 1);
    const bundle = command.match(/(.+?\/Machinen\.app)\/Contents\/MacOS\/Machinen(?:\s|$)/)?.[1];
    if (!Number.isInteger(pid) || !bundle || !pathIsProjectBundle(bundle)) {continue;}
    if (bundleIdentifier(machine, bundle) !== BUNDLE_ID) {continue;}
    processes.push({ pid, bundle });
  }
  return processes;
}

function oneRunningBundle(machine: Machine): string | undefined {
  const bundles = [...new Set(projectAppProcesses(machine).map(({ bundle }) => bundle))];
  if (bundles.length > 1) {
    throw new RebuildError(
      `More than one project Machinen app is running on ${machine}: ${bundles.join(", ")}`,
    );
  }
  return bundles[0];
}

function explicitTarget(machine: Machine): Target {
  const bundle = oneRunningBundle(machine);
  if (bundle) {
    return {
      machine,
      bundle,
      reason: `explicit ${machine} target; using its running app`,
    };
  }
  return {
    machine,
    bundle: machine === "mini" ? MINI_DEFAULT_BUNDLE : AIR_DEFAULT_BUNDLE,
    reason: `explicit ${machine} target; no app is currently running`,
  };
}

function automaticTarget(): Target {
  const terminalId = sessionTerminalId();
  const snapshots: Record<Machine, Record<string, unknown> | undefined> = {
    mini: snapshot("mini"),
    air: snapshot("air"),
  };
  if (terminalId) {
    const matches = (["mini", "air"] as const).filter((machine) =>
      snapshotHasTerminal(snapshots[machine], terminalId),
    );
    if (matches.length === 1) {
      const machine = matches[0];
      const bundle = oneRunningBundle(machine);
      if (!bundle) {
        throw new RebuildError(
          `Terminal ${terminalId} belongs to the ${machine} Desktop, but its project app process could not be found.`,
        );
      }
      return {
        machine,
        bundle,
        reason: `current terminal ${terminalId} belongs to the ${machine} Desktop`,
      };
    }
    if (matches.length > 1) {
      throw new RebuildError(
        `Current terminal ${terminalId} appears in both Desktop apps; rerun with --target mini or --target air.`,
      );
    }
  }

  const running = new Map<Machine, string>();
  for (const machine of ["mini", "air"] as const) {
    const bundle = oneRunningBundle(machine);
    if (bundle) {running.set(machine, bundle);}
  }
  if (running.size === 1) {
    const [machine, bundle] = [...running.entries()][0];
    return {
      machine,
      bundle,
      reason: `only project Desktop app running is on ${machine}`,
    };
  }
  if (running.size > 1) {
    throw new RebuildError(
      "Project Machinen apps are running on both mini and Air, and this terminal does not identify one of them; rerun with --target mini or --target air.",
    );
  }
  throw new RebuildError("No running project Machinen Desktop app was found on mini or Air");
}

function detectTarget(requested: "auto" | Machine): Target {
  return requested === "auto" ? automaticTarget() : explicitTarget(requested);
}

function gitBuffer(args: readonly string[]): Buffer {
  const completed = spawnSync("/usr/bin/git", ["-C", MINI_REPO, ...args], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (completed.error) {throw completed.error;}
  if (completed.status !== 0) {
    throw new RebuildError(
      `git ${args.join(" ")} failed: ${completed.stderr.toString("utf8").trim()}`,
    );
  }
  return completed.stdout;
}

function sourceState(configuration: Configuration): SourceState {
  const gitHead = gitBuffer(["rev-parse", "HEAD"]).toString("utf8").trim();
  const branchResult = run(
    "/usr/bin/git",
    ["-C", MINI_REPO, "symbolic-ref", "--short", "-q", "HEAD"],
    { capture: true, check: false },
  );
  const branch = branchResult.stdout.trim() || "detached";
  const diff = gitBuffer(["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
  const untracked = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();

  const digest = createHash("sha256");
  digest.update(CACHE_FORMAT);
  digest.update("\0");
  digest.update(configuration);
  digest.update("\0");
  digest.update(gitHead);
  digest.update("\0tracked-diff\0");
  digest.update(diff);
  digest.update("\0untracked\0");
  for (const relativePath of untracked) {
    const path = join(MINI_REPO, relativePath);
    const details = lstatSync(path);
    digest.update(relativePath);
    digest.update("\0");
    if (details.isSymbolicLink()) {
      digest.update("symlink\0");
      digest.update(readlinkSync(path));
    } else if (details.isFile()) {
      digest.update(`file:${details.mode.toString(8)}\0`);
      digest.update(readFileSync(path));
    } else {
      digest.update("other\0");
    }
    digest.update("\0");
  }
  const fingerprint = digest.digest("hex");
  return {
    configuration,
    fingerprint,
    gitHead,
    branch,
    dirty: diff.length > 0 || untracked.length > 0,
    buildId: `${configuration}-${fingerprint}`,
  };
}

function emptyHistory(): History {
  return { version: 1, builds: [], relaunches: [] };
}

function loadHistory(): History {
  if (!existsSync(HISTORY_PATH)) {return emptyHistory();}
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
  } catch (error) {
    throw new RebuildError(`Could not read build history ${HISTORY_PATH}: ${error}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).version !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).builds) ||
    !Array.isArray((parsed as Record<string, unknown>).relaunches)
  ) {
    throw new RebuildError(`Invalid build history in ${HISTORY_PATH}`);
  }
  return parsed as History;
}

function saveHistory(history: History): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const temporary = join(STATE_DIR, `.history.json.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(history, null, 2)}\n`);
  renameSync(temporary, HISTORY_PATH);
}

function historyBuild(history: History, buildId: string): Record<string, unknown> | undefined {
  return history.builds.find((entry) => entry.id === buildId);
}

function targetExists(machine: Machine, path: string): boolean {
  return (
    hostRun(machine, "/bin/test", ["-d", path], {
      check: false,
      capture: true,
    }).status === 0
  );
}

function removeTargetPath(machine: Machine, path: string): void {
  hostRun(machine, "/bin/rm", ["-rf", path]);
}

function moveTargetPath(machine: Machine, source: string, destination: string): void {
  hostRun(machine, "/bin/mv", [source, destination]);
}

function copyLocalBundle(source: string, destination: string): void {
  removeTargetPath("mini", destination);
  run("/usr/bin/ditto", [source, destination]);
}

function verifyBundle(machine: Machine, bundle: string): BundleInfo {
  const verification = hostRun(
    machine,
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", bundle],
    { check: false, capture: true },
  );
  if (verification.status !== 0) {
    throw new RebuildError(
      `Code-signature verification failed for ${bundle}: ${(verification.stderr || verification.stdout).trim()}`,
    );
  }
  if (bundleIdentifier(machine, bundle) !== BUNDLE_ID) {
    throw new RebuildError(`Unexpected bundle identifier in ${bundle}`);
  }
  const info = join(bundle, "Contents/Info.plist");
  const version = hostRun(
    machine,
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", info],
    { capture: true },
  ).stdout.trim();
  const build = hostRun(
    machine,
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleVersion", info],
    { capture: true },
  ).stdout.trim();
  const display = hostRun(machine, "/usr/bin/codesign", ["-d", "--verbose=4", bundle], {
    check: false,
    capture: true,
  });
  const cdhash = display.stderr.match(/^CDHash=([0-9a-fA-F]+)$/m)?.[1]?.toLowerCase();
  if (display.status !== 0 || !cdhash) {
    throw new RebuildError(`Could not read code-directory hash from ${bundle}`);
  }
  return { version, build, cdhash };
}

function cachedBuild(state: SourceState): BuildArtifact | undefined {
  const path = join(BUILDS_DIR, state.buildId, "Machinen.app");
  if (!existsSync(path)) {return undefined;}
  let info: BundleInfo;
  try {
    info = verifyBundle("mini", path);
  } catch {
    return undefined;
  }
  const entry = historyBuild(loadHistory(), state.buildId);
  return {
    buildId: state.buildId,
    path,
    info,
    builtAt: typeof entry?.builtAt === "string" ? entry.builtAt : "unknown",
    reused: true,
  };
}

function pruneBuildCache(): void {
  if (!existsSync(BUILDS_DIR)) {return;}
  const directories = readdirSync(BUILDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(BUILDS_DIR, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  for (const old of directories.slice(RETAINED_BUILD_COUNT)) {
    rmSync(old, { recursive: true, force: true });
  }
}

function cacheFreshBuild(
  state: SourceState,
  info: BundleInfo,
  durationSeconds: number,
): BuildArtifact {
  mkdirSync(BUILDS_DIR, { recursive: true });
  const destination = join(BUILDS_DIR, state.buildId);
  const temporary = join(BUILDS_DIR, `.${state.buildId}.${process.pid}.pending`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true });
  try {
    run("/usr/bin/ditto", [ARTIFACT, join(temporary, "Machinen.app")]);
    const cachedInfo = verifyBundle("mini", join(temporary, "Machinen.app"));
    if (cachedInfo.cdhash !== info.cdhash) {
      throw new RebuildError("Cached bundle differs from the freshly built bundle");
    }
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }

  const builtAt = utcNow();
  const history = loadHistory();
  history.builds = history.builds.filter((entry) => entry.id !== state.buildId);
  history.builds.unshift({
    id: state.buildId,
    configuration: state.configuration,
    fingerprint: state.fingerprint,
    gitHead: state.gitHead,
    branch: state.branch,
    dirty: state.dirty,
    builtAt,
    buildHost: "mini",
    sourcePath: MINI_REPO,
    artifactPath: join(destination, "Machinen.app"),
    bundleVersion: info.version,
    bundleBuild: info.build,
    cdhash: info.cdhash,
    durationSeconds: Math.round(durationSeconds * 10) / 10,
  });
  history.builds = history.builds.slice(0, 100);
  saveHistory(history);
  pruneBuildCache();
  return {
    buildId: state.buildId,
    path: join(destination, "Machinen.app"),
    info,
    builtAt,
    reused: false,
  };
}

function copyBundleToAir(source: string, destination: string, token: string): void {
  const remoteArchive = `/tmp/machinen-desktop-relaunch-${token}.zip`;
  const remoteExtract = `/tmp/machinen-desktop-relaunch-${token}`;
  const temporary = mkdtempSync(join(tmpdir(), "machinen-desktop-relaunch-"));
  const archive = join(temporary, "Machinen.zip");
  try {
    run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", source, archive]);
    run("/usr/bin/scp", ["-q", archive, `${AIR_HOST}:${remoteArchive}`]);
    const script = [
      "set -euo pipefail",
      `/bin/rm -rf ${shellQuote(remoteExtract)} ${shellQuote(destination)}`,
      `/bin/mkdir -p ${shellQuote(remoteExtract)} ${shellQuote(dirname(destination))}`,
      `/usr/bin/ditto -x -k ${shellQuote(remoteArchive)} ${shellQuote(remoteExtract)}`,
      `/bin/mv ${shellQuote(join(remoteExtract, "Machinen.app"))} ${shellQuote(destination)}`,
    ].join("\n");
    hostRun("air", "/bin/bash", ["-c", script]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    hostRun("air", "/bin/rm", ["-rf", remoteArchive, remoteExtract], {
      check: false,
      capture: true,
    });
  }
}

function appPidsForBundle(machine: Machine, bundle: string): number[] {
  return projectAppProcesses(machine)
    .filter((process) => process.bundle === bundle)
    .map((process) => process.pid);
}

function pidsAlive(machine: Machine, pids: number[]): number[] {
  return pids.filter(
    (pid) =>
      hostRun(machine, "/bin/kill", ["-0", String(pid)], {
        check: false,
        capture: true,
      }).status === 0,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForPidsToExit(
  machine: Machine,
  pids: number[],
  timeoutSeconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (pidsAlive(machine, pids).length === 0) {return true;}
    await delay(250);
  }
  return pidsAlive(machine, pids).length === 0;
}

async function stopBundle(machine: Machine, bundle: string, graceful: boolean): Promise<void> {
  const pids = appPidsForBundle(machine, bundle);
  if (pids.length === 0) {return;}
  if (graceful) {
    const quit = hostRun(
      machine,
      "/usr/bin/osascript",
      ["-e", `tell application id "${BUNDLE_ID}" to quit`],
      { check: false, capture: true },
    );
    if (quit.status === 0 && (await waitForPidsToExit(machine, pids, 10))) {return;}
  }
  for (const [signal, timeout] of [
    ["-TERM", 5],
    ["-KILL", 2],
  ] as const) {
    const alive = pidsAlive(machine, pids);
    if (alive.length === 0) {return;}
    hostRun(machine, "/bin/kill", [signal, ...alive.map(String)], {
      check: false,
      capture: true,
    });
    if (await waitForPidsToExit(machine, alive, timeout)) {return;}
  }
  throw new RebuildError(`Machinen Desktop would not stop on ${machine}`);
}

function openBundle(machine: Machine, bundle: string): void {
  hostRun(machine, "/usr/bin/open", [bundle]);
}

async function waitForLaunch(
  machine: Machine,
  bundle: string,
  timeoutSeconds = 20,
): Promise<number> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const pids = appPidsForBundle(machine, bundle);
    if (pids[0]) {return pids[0];}
    await delay(500);
  }
  throw new RebuildError(`Machinen Desktop did not launch from ${bundle} on ${machine}`);
}

async function waitForApi(machine: Machine, timeoutSeconds = 20): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    if (snapshot(machine)) {return;}
    await delay(500);
  }
  throw new RebuildError(`Machinen Desktop API did not become ready on ${machine}`);
}

function timestampToken(): string {
  return `${new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, "")
    .slice(0, 14)}-${process.pid}`;
}

function backupPath(bundle: string, token: string): string {
  return join(dirname(bundle), `Machinen.app.before-relaunch-${token}`);
}

function pendingPath(bundle: string, token: string): string {
  return join(dirname(bundle), `.Machinen.app.pending-${token}`);
}

async function restoreBackup(machine: Machine, bundle: string, backup: string): Promise<void> {
  await stopBundle(machine, bundle, false);
  removeTargetPath(machine, bundle);
  moveTargetPath(machine, backup, bundle);
  openBundle(machine, bundle);
  await waitForLaunch(machine, bundle);
  console.error(`Restored and reopened previous bundle: ${bundle}`);
}

function recordRelaunch(
  artifact: BuildArtifact,
  target: Target,
  pid: number,
  deployed: boolean,
): void {
  const history = loadHistory();
  history.relaunches.unshift({
    at: utcNow(),
    buildId: artifact.buildId,
    targetMachine: target.machine,
    bundlePath: target.bundle,
    pid,
    deployed,
    buildReused: artifact.reused,
  });
  history.relaunches = history.relaunches.slice(0, 200);
  saveHistory(history);
}

function prepareBuild(
  state: SourceState,
  forceBuild: boolean,
  buildRollback: string | undefined,
): BuildArtifact {
  if (!forceBuild) {
    const cached = cachedBuild(state);
    if (cached) {
      console.log(
        `Reusing cached ${state.configuration} build ${state.fingerprint.slice(0, 12)} from ${cached.builtAt}`,
      );
      return cached;
    }
  }

  const started = performance.now();
  console.log(
    `Building ${state.configuration} on mini: ${join(DESKTOP_DIR, "build-app.sh")} ${state.configuration}`,
  );
  try {
    run(join(DESKTOP_DIR, "build-app.sh"), [state.configuration], {
      cwd: DESKTOP_DIR,
    });
    const durationSeconds = (performance.now() - started) / 1_000;
    const info = verifyBundle("mini", ARTIFACT);
    const artifact = cacheFreshBuild(state, info, durationSeconds);
    console.log(
      `Built and cached Machinen ${info.version} (${info.build}) in ${durationSeconds.toFixed(1)}s`,
    );
    return artifact;
  } catch (error) {
    if (buildRollback && targetExists("mini", buildRollback)) {
      removeTargetPath("mini", ARTIFACT);
      moveTargetPath("mini", buildRollback, ARTIFACT);
    }
    throw error;
  }
}

async function buildAndRelaunch(
  target: Target,
  configuration: Configuration,
  forceBuild: boolean,
): Promise<void> {
  const token = timestampToken();
  const state = sourceState(configuration);
  let backup: string | undefined;
  let pending: string | undefined;
  let buildRollback: string | undefined;
  let quitStarted = false;

  console.log(`Target: ${target.machine}`);
  console.log(`Reason: ${target.reason}`);
  console.log(`Bundle: ${target.bundle}`);
  console.log(`Build source: ${MINI_REPO} (mini)`);
  console.log(
    `Source: ${state.branch}@${state.gitHead.slice(0, 12)}${state.dirty ? " dirty" : ""}; fingerprint ${state.fingerprint.slice(0, 12)}`,
  );

  const cachedBeforeBuild = forceBuild ? undefined : cachedBuild(state);
  if (!cachedBeforeBuild && targetExists("mini", ARTIFACT)) {
    buildRollback = backupPath(ARTIFACT, token);
    console.log(`Saving build rollback bundle: ${buildRollback}`);
    copyLocalBundle(ARTIFACT, buildRollback);
  }

  const artifact = prepareBuild(state, forceBuild, buildRollback);
  if (buildRollback) {
    if (target.machine === "mini" && target.bundle === ARTIFACT) {
      backup = buildRollback;
    } else {
      removeTargetPath("mini", buildRollback);
    }
    buildRollback = undefined;
  }

  let targetInfo: BundleInfo | undefined;
  if (targetExists(target.machine, target.bundle)) {
    try {
      targetInfo = verifyBundle(target.machine, target.bundle);
    } catch {
      targetInfo = undefined;
    }
  }
  const alreadyDeployed = targetInfo?.cdhash === artifact.info.cdhash;

  try {
    if (alreadyDeployed) {
      console.log("Target already has this exact build; relaunching without deployment");
    } else {
      pending = pendingPath(target.bundle, token);
      console.log(`Staging cached build on ${target.machine}: ${pending}`);
      if (target.machine === "mini") {copyLocalBundle(artifact.path, pending);}
      else {copyBundleToAir(artifact.path, pending, token);}
      if (verifyBundle(target.machine, pending).cdhash !== artifact.info.cdhash) {
        throw new RebuildError("Staged bundle differs from the cached build");
      }
    }

    quitStarted = true;
    console.log(`Quitting Machinen Desktop on ${target.machine}`);
    await stopBundle(target.machine, target.bundle, true);

    if (pending) {
      if (targetExists(target.machine, target.bundle)) {
        if (backup && targetExists(target.machine, backup)) {
          removeTargetPath(target.machine, backup);
        }
        backup = backupPath(target.bundle, token);
        moveTargetPath(target.machine, target.bundle, backup);
      }
      moveTargetPath(target.machine, pending, target.bundle);
      pending = undefined;
    }

    const deployedInfo = verifyBundle(target.machine, target.bundle);
    if (deployedInfo.cdhash !== artifact.info.cdhash) {
      throw new RebuildError("Deployed bundle differs from the selected cached build");
    }
    console.log(`Opening ${target.bundle}`);
    openBundle(target.machine, target.bundle);
    const pid = await waitForLaunch(target.machine, target.bundle);
    await waitForApi(target.machine);
    if (backup && targetExists(target.machine, backup)) {
      removeTargetPath(target.machine, backup);
      backup = undefined;
    }
    recordRelaunch(artifact, target, pid, !alreadyDeployed);
    console.log(
      `Relaunched Machinen ${deployedInfo.version} (${deployedInfo.build}) on ${target.machine}; pid ${pid}; API ready; history: ${HISTORY_PATH}`,
    );
  } catch (error) {
    if (pending) {removeTargetPath(target.machine, pending);}
    if (quitStarted && backup && targetExists(target.machine, backup)) {
      try {
        await restoreBackup(target.machine, target.bundle, backup);
        backup = undefined;
      } catch (rollbackError) {
        throw new RebuildError(`Relaunch failed: ${error}; rollback also failed: ${rollbackError}`);
      }
    } else if (quitStarted && targetExists(target.machine, target.bundle)) {
      try {
        openBundle(target.machine, target.bundle);
      } catch {
        // Preserve the original error.
      }
    }
    throw error;
  }
}

function printHistory(): void {
  const history = loadHistory();
  console.log(`History: ${HISTORY_PATH}`);
  console.log("Builds:");
  if (history.builds.length === 0) {console.log("  none");}
  for (const entry of history.builds.slice(0, 20)) {
    const artifactPath = String(entry.artifactPath ?? "");
    const retained = artifactPath && existsSync(artifactPath) ? "cached" : "metadata only";
    console.log(
      `  ${entry.builtAt ?? "unknown"}  ${String(entry.fingerprint ?? "").slice(0, 12)}  ${entry.configuration ?? "?"}  Machinen ${entry.bundleVersion ?? "?"} (${entry.bundleBuild ?? "?"})  ${entry.buildHost ?? "?"}  ${retained}`,
    );
  }
  console.log("Relaunches:");
  if (history.relaunches.length === 0) {console.log("  none");}
  for (const entry of history.relaunches.slice(0, 20)) {
    console.log(
      `  ${entry.at ?? "unknown"}  ${entry.targetMachine ?? "?"}  ${entry.deployed ? "deployed" : "relaunch only"}  ${entry.bundlePath ?? "?"}`,
    );
  }
}

function printPlan(target: Target, state: SourceState, forceBuild: boolean): void {
  console.log(`Target: ${target.machine}`);
  console.log(`Reason: ${target.reason}`);
  console.log(`Bundle: ${target.bundle}`);
  console.log(`Build source: ${MINI_REPO} (mini)`);
  console.log(
    `Source: ${state.branch}@${state.gitHead.slice(0, 12)}${state.dirty ? " dirty" : ""}; fingerprint ${state.fingerprint.slice(0, 12)}`,
  );
  const artifact = forceBuild ? undefined : cachedBuild(state);
  if (!artifact) {
    console.log(
      `Plan: build ${state.configuration} on mini (${forceBuild ? "forced" : "no matching cached build"}), then deploy and relaunch`,
    );
    return;
  }
  console.log(`Cached build: ${artifact.path} (built ${artifact.builtAt})`);
  let targetInfo: BundleInfo | undefined;
  if (targetExists(target.machine, target.bundle)) {
    try {
      targetInfo = verifyBundle(target.machine, target.bundle);
    } catch {
      targetInfo = undefined;
    }
  }
  console.log(
    targetInfo?.cdhash === artifact.info.cdhash
      ? "Plan: target already has this exact build; relaunch only"
      : "Plan: reuse cached build, deploy it, and relaunch",
  );
}

interface Arguments {
  target: "auto" | Machine;
  configuration: Configuration;
  forceBuild: boolean;
  detectOnly: boolean;
  history: boolean;
}

function argumentsFromCli(): Arguments {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "auto" },
      configuration: { type: "string", default: "release" },
      "force-build": { type: "boolean", default: false },
      "detect-only": { type: "boolean", default: false },
      history: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!(["auto", "mini", "air"] as string[]).includes(values.target)) {
    throw new RebuildError("--target must be auto, mini, or air");
  }
  if (!(["debug", "release"] as string[]).includes(values.configuration)) {
    throw new RebuildError("--configuration must be debug or release");
  }
  return {
    target: values.target as "auto" | Machine,
    configuration: values.configuration as Configuration,
    forceBuild: values["force-build"],
    detectOnly: values["detect-only"],
    history: values.history,
  };
}

async function main(): Promise<void> {
  const args = argumentsFromCli();
  ensureMiniCheckout();
  if (args.history) {
    printHistory();
    return;
  }
  const target = detectTarget(args.target);
  const state = sourceState(args.configuration);
  if (args.detectOnly) {
    printPlan(target, state, args.forceBuild);
    return;
  }
  await buildAndRelaunch(target, args.configuration, args.forceBuild);
}

main().catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
