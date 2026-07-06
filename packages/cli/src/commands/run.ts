import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { attach, boot, list, provision, type LogEvent, type VmHandle } from "@machinen/runtime";

import { DEFAULT_PTY_SESSION_NAME } from "../defaults.ts";
import { die } from "../errors.ts";
import { runPtyExec } from "./pty.ts";

interface RunRecipe {
  name: string;
  summary: string;
  imagePath: string;
  stateDirs: Array<{ host: string; guest: string }>;
  install: string;
  command: string;
  env?: Record<string, string>;
}

interface RunOptions {
  recipe: RunRecipe;
  rebuild: boolean;
  sessionName?: string;
  vmName: string;
  toolArgs: string[];
}

const RECIPES: RunRecipe[] = [
  {
    name: "pi",
    summary: "Run the pi coding agent inside a VM.",
    imagePath: join(homedir(), ".machinen", "run", "pi", "rootfs.tar.gz"),
    stateDirs: [{ host: join(homedir(), ".pi", "agent"), guest: "/root/.pi/agent" }],
    install: `
      fnm install 24
      fnm default 24
      npm install -g --ignore-scripts @earendil-works/pi-coding-agent
      pi --version
    `,
    command: "pi",
  },
  {
    name: "command-code",
    summary: "Run Command Code inside a VM.",
    imagePath: join(homedir(), ".machinen", "run", "command-code", "rootfs.tar.gz"),
    stateDirs: [{ host: join(homedir(), ".commandcode"), guest: "/root/.commandcode" }],
    install: `
      fnm install 24
      fnm default 24
      npm install -g command-code@latest
      cmd --version
    `,
    command: "cmd",
  },
  {
    name: "claude",
    summary: "Run Claude Code inside a VM.",
    imagePath: join(homedir(), ".machinen", "run", "claude", "rootfs.tar.gz"),
    stateDirs: [{ host: join(homedir(), ".claude"), guest: "/root/.claude" }],
    install: `
      fnm install 24
      fnm default 24
      npm install -g @anthropic-ai/claude-code
      claude --version
    `,
    command: "claude",
    env: { CLAUDE_CONFIG_DIR: "/root/.claude" },
  },
  {
    name: "codex",
    summary: "Run Codex inside a VM.",
    imagePath: join(homedir(), ".machinen", "run", "codex", "rootfs.tar.gz"),
    stateDirs: [{ host: join(homedir(), ".codex"), guest: "/root/.codex" }],
    install: `
      fnm install 24
      fnm default 24
      npm install -g @openai/codex
      codex --version
    `,
    command: "codex",
    env: { CODEX_HOME: "/root/.codex" },
  },
];

// fallow-ignore-next-line complexity
export async function cmdRun(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printRunHelp();
    return 0;
  }
  if (args[0] === "list") {
    printRunList();
    return 0;
  }

  const opts = parseRunCommandArgs(args);
  await ensureRecipeImage(opts);
  return await runRecipe(opts);
}

// fallow-ignore-next-line complexity
function parseRunCommandArgs(args: string[]): RunOptions {
  const recipeName = args[0]!;
  const recipe = RECIPES.find((candidate) => candidate.name === recipeName);
  if (!recipe) {
    die(`unknown run target: ${recipeName}\nRun 'machinen run list' to see available targets.`);
  }

  let rebuild = false;
  let sessionName: string | undefined;
  let vmName = defaultSessionVmName(recipe);
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
    toolArgs.push(arg);
  }
  return { recipe, rebuild, sessionName, vmName, toolArgs };
}

function defaultSessionVmName(recipe: RunRecipe): string {
  const cwd = resolve(process.cwd());
  const label = basename(cwd) || "workspace";
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 10);
  return `run/${recipe.name}/${label}-${hash}`;
}

// fallow-ignore-next-line complexity
function readFlagValue(
  args: string[],
  index: number,
  arg: string,
  flag: "--name" | "--session",
): { value: string; index: number } {
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) {
      die(`${flag} requires a value`);
    }
    return { value, index };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    die(`${flag} requires a value`);
  }
  return { value, index: index + 1 };
}

function validateSessionName(value: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    die("--session must be 1-64 characters using only letters, digits, dot, underscore, or dash");
  }
}

async function ensureRecipeImage(opts: RunOptions): Promise<void> {
  if (opts.rebuild) {
    rmSync(opts.recipe.imagePath, { force: true });
  }
  if (existsSync(opts.recipe.imagePath)) {
    return;
  }

  mkdirSync(dirname(opts.recipe.imagePath), { recursive: true });
  process.stderr.write(`machinen: baking ${opts.recipe.name} image...\n`);
  await provision({
    install: async (vm) => {
      await vm.exec(opts.recipe.install);
    },
    out: opts.recipe.imagePath,
    onLog: writeProvisionLog,
  });
  process.stderr.write(`machinen: baked ${opts.recipe.name} image at ${opts.recipe.imagePath}\n`);
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
  ensureStateDirs(opts.recipe);
  const vm = await boot({
    image: opts.recipe.imagePath,
    liveMounts: liveMountsForRecipe(opts.recipe),
    guestCwd: "/mnt/workspace",
    cmd: [
      "/bin/bash",
      "-lc",
      `exec ${opts.recipe.command} "$@"`,
      opts.recipe.command,
      ...opts.toolArgs,
    ],
    env: envForRecipe(opts.recipe),
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
  ensureStateDirs(opts.recipe);
  const vm = await attachOrBootSessionVm(opts);
  const cmd = recipeShellCommand(opts);
  process.stderr.write(
    `attached to ${opts.vmName} session ${opts.sessionName} — reattach with machinen run ${opts.recipe.name} --session ${opts.sessionName}.\n`,
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
    image: opts.recipe.imagePath,
    liveMounts: liveMountsForRecipe(opts.recipe),
    guestCwd: "/mnt/workspace",
    cmd: ["/bin/bash", "-lc", "sleep infinity"],
    env: envForRecipe(opts.recipe),
    detached: true,
    timeoutMs: null,
  });
  return await attach({ name: opts.vmName });
}

function envForRecipe(recipe: RunRecipe): Record<string, string> {
  return { HOME: "/root", ...recipe.env };
}

function liveMountsForRecipe(recipe: RunRecipe) {
  return [
    { host: resolve(process.cwd()), guest: "/mnt/workspace", mode: "rw" as const },
    ...recipe.stateDirs.map((dir) => ({ host: dir.host, guest: dir.guest, mode: "rw" as const })),
  ];
}

function recipeShellCommand(opts: RunOptions): string {
  const args = opts.toolArgs.map(shellQuote).join(" ");
  return args.length === 0 ? opts.recipe.command : `${opts.recipe.command} ${args}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function ensureStateDirs(recipe: RunRecipe): void {
  for (const dir of recipe.stateDirs) {
    mkdirSync(dir.host, { recursive: true });
  }
}

function printRunList(): void {
  for (const recipe of RECIPES) {
    process.stdout.write(`${recipe.name}\t${recipe.summary}\n`);
  }
}

function printRunHelp(): void {
  process.stdout.write(
    `Usage:\n` +
      `  machinen run <target> [--rebuild] [--session <name>] [-- <args...>]\n` +
      `  machinen run list\n` +
      `\n` +
      `Targets:\n` +
      RECIPES.map((recipe) => `  ${recipe.name.padEnd(14)} ${recipe.summary}\n`).join("") +
      `\n` +
      `Examples:\n` +
      `  machinen run pi\n` +
      `  machinen run command-code -- --help\n` +
      `  machinen run claude --session work\n` +
      `  machinen run codex --session work\n`,
  );
}
