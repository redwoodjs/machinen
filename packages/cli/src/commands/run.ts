import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { attach, boot, list, provision, type LogEvent, type VmHandle } from "@machinen/runtime";

import { resolveCliBaseAssets, type CliBaseAssetPaths } from "../base-assets.ts";
import { DEFAULT_PTY_SESSION_NAME } from "../defaults.ts";
import { die } from "../errors.ts";
import { planRunAccess, type RunAccessPlan } from "../run-access.ts";
import { approveRunRecipe, hasRunRecipeApproval } from "../run-approval.ts";
import {
  loadRunRecipe,
  loadRunRegistry,
  type RunRecipe,
  type VerifiedRunRecipe,
} from "../run-registry.ts";
import { runPtyExec } from "./pty.ts";

interface ParsedRunArgs {
  reference: string;
  rebuild: boolean;
  sessionName?: string;
  vmName?: string;
  expectedDigest?: string;
  inspect: boolean;
  trust: boolean;
  toolArgs: string[];
}

interface RunOptions extends ParsedRunArgs {
  verified: VerifiedRunRecipe;
  access: RunAccessPlan;
  imagePath: string;
  vmName: string;
  baseAssets: CliBaseAssetPaths;
}

// fallow-ignore-next-line complexity
export async function cmdRun(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printRunHelp();
    return 0;
  }
  if (args[0] === "list") {
    await printRunList();
    return 0;
  }

  const parsed = parseRunCommandArgs(args);
  const verified = await loadRunRecipe(parsed.reference);
  verifyExpectedDigest(parsed.expectedDigest, verified);
  const access = planRunAccess(verified.recipe);
  if (parsed.inspect) {
    printRecipeInspection(verified, access);
    return 0;
  }
  await ensureRecipeApproved(verified, access, parsed.trust);
  const baseAssets = await resolveCliBaseAssets();
  const opts = buildRunOptions(parsed, verified, access, baseAssets);
  await ensureRecipeImage(opts);
  return await runRecipe(opts);
}

// fallow-ignore-next-line complexity
function parseRunCommandArgs(args: string[]): ParsedRunArgs {
  const reference = args[0]!;
  let rebuild = false;
  let sessionName: string | undefined;
  let vmName: string | undefined;
  let expectedDigest: string | undefined;
  let inspect = false;
  let trust = false;
  const toolArgs: string[] = [];
  let passthrough = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (passthrough) {
      toolArgs.push(arg);
      continue;
    }
    if (arg === "--") {
      passthrough = true;
      continue;
    }
    if (arg === "--rebuild") {
      rebuild = true;
      continue;
    }
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (arg === "--trust") {
      trust = true;
      continue;
    }
    if (arg === "--session" || arg.startsWith("--session=")) {
      const parsed = readFlagValue(args, i, arg, "--session");
      sessionName = parsed.value || DEFAULT_PTY_SESSION_NAME;
      i = parsed.index;
      validateSessionName(sessionName);
      continue;
    }
    if (arg === "--name" || arg.startsWith("--name=")) {
      const parsed = readFlagValue(args, i, arg, "--name");
      vmName = parsed.value;
      i = parsed.index;
      continue;
    }
    if (arg === "--digest" || arg.startsWith("--digest=")) {
      const parsed = readFlagValue(args, i, arg, "--digest");
      expectedDigest = parseDigest(parsed.value);
      i = parsed.index;
      continue;
    }
    toolArgs.push(arg);
  }
  return {
    reference,
    rebuild,
    sessionName,
    vmName,
    expectedDigest,
    inspect,
    trust,
    toolArgs,
  };
}

function buildRunOptions(
  parsed: ParsedRunArgs,
  verified: VerifiedRunRecipe,
  access: RunAccessPlan,
  baseAssets: CliBaseAssetPaths,
): RunOptions {
  return {
    ...parsed,
    verified,
    access,
    imagePath: recipeImagePath(verified),
    vmName: parsed.vmName ?? defaultSessionVmName(verified, access),
    baseAssets,
  };
}

function recipeImagePath(verified: VerifiedRunRecipe): string {
  return join(
    homedir(),
    ".machinen",
    "run",
    "images",
    verified.recipe.name,
    verified.digest,
    "rootfs.tar.gz",
  );
}

function defaultSessionVmName(verified: VerifiedRunRecipe, access: RunAccessPlan): string {
  const cwd = resolve(process.cwd());
  const label = basename(cwd) || "workspace";
  const workspaceHash = createHash("sha256").update(cwd).digest("hex").slice(0, 10);
  return (
    `run/${verified.recipe.name}/${label}-${workspaceHash}-${verified.digest.slice(0, 8)}-` +
    access.fingerprint.slice(0, 8)
  );
}

type RunValueFlag = "--digest" | "--name" | "--session";

function readFlagValue(
  args: string[],
  index: number,
  arg: string,
  flag: RunValueFlag,
): { value: string; index: number } {
  return arg.startsWith(`${flag}=`)
    ? readInlineFlagValue(index, arg, flag)
    : readFollowingFlagValue(args, index, flag);
}

function readInlineFlagValue(
  index: number,
  arg: string,
  flag: RunValueFlag,
): { value: string; index: number } {
  return { value: requireFlagValue(arg.slice(flag.length + 1), flag), index };
}

function readFollowingFlagValue(
  args: string[],
  index: number,
  flag: RunValueFlag,
): { value: string; index: number } {
  return { value: requireFlagValue(args[index + 1], flag), index: index + 1 };
}

function requireFlagValue(value: string | undefined, flag: RunValueFlag): string {
  if (!value || value.startsWith("-")) {
    die(`${flag} requires a value`);
  }
  return value;
}

function parseDigest(value: string): string {
  const digest = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    die("--digest must be a sha256: prefix followed by 64 lowercase hexadecimal characters");
  }
  return digest;
}

function verifyExpectedDigest(expected: string | undefined, verified: VerifiedRunRecipe): void {
  if (expected !== undefined && expected !== verified.digest) {
    die(
      `run recipe digest mismatch\n` +
        `  expected: sha256:${expected}\n` +
        `  received: sha256:${verified.digest}`,
    );
  }
}

function validateSessionName(value: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    die("--session must be 1-64 characters using only letters, digits, dot, underscore, or dash");
  }
}

async function ensureRecipeApproved(
  verified: VerifiedRunRecipe,
  access: RunAccessPlan,
  trust: boolean,
): Promise<void> {
  if (hasRunRecipeApproval(verified, access.fingerprint)) {
    return;
  }
  printRecipeCapabilities(verified, access);
  if (trust) {
    trustRecipeWithoutPrompt(verified, access);
    return;
  }
  await promptToTrustRecipe(verified, access);
}

function trustRecipeWithoutPrompt(verified: VerifiedRunRecipe, access: RunAccessPlan): void {
  approveRunRecipe(verified, access.fingerprint);
  process.stderr.write("machinen: trusted this signed recipe and resolved host access.\n");
}

async function promptToTrustRecipe(
  verified: VerifiedRunRecipe,
  access: RunAccessPlan,
): Promise<void> {
  requireInteractiveTrust(verified);
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question("Trust this signed recipe and host access? [y/N] ");
  readline.close();
  if (!isYes(answer)) {
    die("run recipe was not approved");
  }
  approveRunRecipe(verified, access.fingerprint);
}

function requireInteractiveTrust(verified: VerifiedRunRecipe): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    die(
      `run recipe permissions have not been approved.\n` +
        `Inspect with 'machinen run ${verified.source} --inspect'.\n` +
        `Re-run with --trust to approve this signed recipe and resolved host access.`,
    );
  }
}

function isYes(value: string): boolean {
  return new Set(["y", "yes"]).has(value.trim().toLowerCase());
}

function printRecipeCapabilities(verified: VerifiedRunRecipe, access: RunAccessPlan): void {
  const recipe = verified.recipe;
  process.stderr.write(
    `\nRecipe: ${recipe.name}\n` +
      `Publisher: ${recipe.publisher} (signature verified: ${verified.keyId})\n` +
      `Digest: sha256:${verified.digest}\n` +
      `Requests:\n` +
      `  outbound network\n` +
      `  ${workspaceDescription(recipe)}\n` +
      stateDescriptions(access) +
      `\n`,
  );
}

function workspaceDescription(recipe: RunRecipe): string {
  if (recipe.permissions.workspace === "none") {
    return "no workspace mount";
  }
  const access = recipe.permissions.workspace === "rw" ? "read/write" : "read-only";
  return `${access} workspace ${resolve(process.cwd())} at /mnt/workspace`;
}

function stateDescriptions(access: RunAccessPlan): string {
  if (access.states.length === 0) {
    return "  no persistent state\n";
  }
  return access.states
    .map((state) => {
      const mode = state.mode === "rw" ? "read/write" : "read-only";
      const source = state.source === "home" ? "host state" : "isolated state";
      const root =
        `  ${mode} ${source} ${formatHostPath(state.host)} at ${state.guest}` +
        resolvedHostDescription(state.resolvedHost) +
        "\n";
      const linked = state.linked
        .map(
          (mount) =>
            `    including linked host path ${formatHostPath(mount.host)} at ${mount.guest}` +
            resolvedHostDescription(mount.resolvedHost) +
            "\n",
        )
        .join("");
      const unresolved = state.unresolvedLinks
        .map((link) => `    unresolved state link ${link}\n`)
        .join("");
      return root + linked + unresolved;
    })
    .join("");
}

function resolvedHostDescription(path: string | undefined): string {
  return path === undefined ? "" : ` (resolves to ${formatHostPath(path)})`;
}

function formatHostPath(path: string): string {
  const home = homedir();
  return path === home
    ? "~"
    : path.startsWith(`${home}/`)
      ? `~/${path.slice(home.length + 1)}`
      : path;
}

function printRecipeInspection(verified: VerifiedRunRecipe, access: RunAccessPlan): void {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: 1,
        source: verified.source,
        digest: `sha256:${verified.digest}`,
        signature: { verified: true, key_id: verified.keyId },
        recipe: verified.recipe,
        workspace: access.workspace ?? null,
        state: access.states,
      },
      null,
      2,
    )}\n`,
  );
}

async function ensureRecipeImage(opts: RunOptions): Promise<void> {
  if (opts.rebuild) {
    rmSync(opts.imagePath, { force: true });
  }
  if (existsSync(opts.imagePath)) {
    return;
  }

  mkdirSync(dirname(opts.imagePath), { recursive: true });
  process.stderr.write(`machinen: baking ${opts.verified.recipe.name} image...\n`);
  await provision({
    base: opts.baseAssets.defaultImagePath,
    kernel: opts.baseAssets.kernelPath,
    dtb: opts.baseAssets.dtbPath,
    install: async (vm) => {
      await vm.exec(opts.verified.recipe.install.join("\n"));
    },
    out: opts.imagePath,
    onLog: writeProvisionLog,
  });
  process.stderr.write(`machinen: baked ${opts.verified.recipe.name} image at ${opts.imagePath}\n`);
}

function writeProvisionLog(evt: LogEvent): void {
  if (evt.source === "phase") {
    return;
  }
  if (evt.source === "exec-stdout" || evt.source === "exec-stderr") {
    process.stderr.write(evt.chunk);
  }
}

async function runRecipe(opts: RunOptions): Promise<number> {
  return opts.sessionName ? runRecipeSession(opts) : runRecipeForeground(opts);
}

async function runRecipeForeground(opts: RunOptions): Promise<number> {
  ensureStateDirs(opts.access);
  const vm = await boot({
    image: opts.imagePath,
    kernel: opts.baseAssets.kernelPath,
    dtb: opts.baseAssets.dtbPath,
    liveMounts: opts.access.liveMounts,
    guestCwd: guestCwdForRecipe(opts.verified.recipe),
    cmd: recipeCommand(opts),
    env: envForRecipe(opts.verified.recipe),
    stdio: "inherit",
    timeoutMs: null,
  });
  const { code } = await vm.wait();
  return code ?? 0;
}

async function runRecipeSession(opts: RunOptions): Promise<number> {
  if (!process.stdin.isTTY) {
    die("machinen run --session: stdin is not a TTY");
  }
  ensureStateDirs(opts.access);
  const vm = await attachOrBootSessionVm(opts);
  const cmd = recipeShellCommand(opts);
  process.stderr.write(
    `attached to ${opts.vmName} session ${opts.sessionName} — reattach with ` +
      `machinen run ${opts.reference} --session ${opts.sessionName}.\n`,
  );
  try {
    return await runPtyExec(vm, cmd, opts.sessionName);
  } finally {
    await vm.detach();
  }
}

async function attachOrBootSessionVm(opts: RunOptions): Promise<VmHandle> {
  const existing = list().find((entry) => entry.name === opts.vmName);
  if (existing) {
    return await attach({ name: opts.vmName });
  }
  await boot({
    name: opts.vmName,
    image: opts.imagePath,
    kernel: opts.baseAssets.kernelPath,
    dtb: opts.baseAssets.dtbPath,
    liveMounts: opts.access.liveMounts,
    guestCwd: guestCwdForRecipe(opts.verified.recipe),
    cmd: ["/bin/bash", "-lc", "sleep infinity"],
    env: envForRecipe(opts.verified.recipe),
    detached: true,
    timeoutMs: null,
  });
  return await attach({ name: opts.vmName });
}

function recipeCommand(opts: RunOptions): string[] {
  const command = opts.verified.recipe.command.map(shellQuote).join(" ");
  return ["/bin/bash", "-lc", `exec ${command} "$@"`, opts.verified.recipe.name, ...opts.toolArgs];
}

function envForRecipe(recipe: RunRecipe): Record<string, string> {
  return { HOME: "/root", ...recipe.env };
}

function guestCwdForRecipe(recipe: RunRecipe): string {
  return recipe.permissions.workspace === "none" ? "/root" : "/mnt/workspace";
}

function recipeShellCommand(opts: RunOptions): string {
  return [...opts.verified.recipe.command, ...opts.toolArgs].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function ensureStateDirs(access: RunAccessPlan): void {
  for (const state of access.states) {
    mkdirSync(state.host, { recursive: true, mode: 0o700 });
  }
}

async function printRunList(): Promise<void> {
  const registry = await loadRunRegistry();
  for (const recipe of registry.recipes) {
    const aliases = recipe.aliases?.length ? recipe.aliases.join(",") : "-";
    process.stdout.write(`${recipe.source}\t${recipe.summary}\t${aliases}\n`);
  }
}

function printRunHelp(): void {
  process.stdout.write(
    `Usage:\n` +
      `  machinen run <machinen.dev/run/recipe> [options] [-- <args...>]\n` +
      `  machinen run list\n` +
      `\n` +
      `Options:\n` +
      `  --inspect            Verify and print the recipe without running it.\n` +
      `  --trust              Approve the signed recipe and host access without a prompt.\n` +
      `  --digest <sha256>    Require an exact signed recipe digest.\n` +
      `  --rebuild            Delete and rebuild this digest's cached image.\n` +
      `  --session <name>     Run or reconnect in a persistent PTY session.\n` +
      `  --name <vm-name>     Override the VM name used by --session.\n` +
      `\n` +
      `Recipes are signed by machinen.dev. They can request network access, the current\n` +
      `workspace, and persistent state. State below /root mirrors the matching host-home\n` +
      `path, including linked roots; all effective host access is shown for approval.\n` +
      `\n` +
      `Examples:\n` +
      `  machinen run machinen.dev/run/claude-code\n` +
      `  machinen run https://machinen.dev/run/claude-code --inspect\n` +
      `  machinen run machinen.dev/run/pi --trust\n` +
      `  machinen run machinen.dev/run/codex --session work\n`,
  );
}
