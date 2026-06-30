import { provision, type LogEvent } from "@machinen/runtime";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { die, handleError } from "../errors.ts";

export type AgentRecipeName = "pi" | "claude";

interface AgentRecipe {
  name: AgentRecipeName;
  displayName: string;
  npmPackage: string;
  binary: string;
  aliases: string;
  bootstrap: string;
}

const RECIPES: Record<AgentRecipeName, AgentRecipe> = {
  pi: {
    name: "pi",
    displayName: "Pi",
    npmPackage: "@earendil-works/pi-coding-agent",
    binary: "pi",
    aliases: "",
    bootstrap:
      "\n# Optional: mount host Pi auth at /mnt/pi-agent to reuse it in this VM.\n" +
      "if [ -d /mnt/pi-agent ]; then\n" +
      "  mkdir -p /root/.pi\n" +
      "  ln -sfn /mnt/pi-agent /root/.pi/agent\n" +
      "fi\n",
  },
  claude: {
    name: "claude",
    displayName: "Claude Code",
    npmPackage: "@anthropic-ai/claude-code",
    binary: "claude",
    aliases:
      "\n# Optional shortcut for fully-autonomous VM-contained runs.\n" +
      "claude-yolo() {\n" +
      '  command claude --dangerously-skip-permissions "$@"\n' +
      "}\n",
    bootstrap: "",
  },
};

export interface BakeOptions {
  recipe?: AgentRecipeName;
  out?: string;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  timeoutMs?: number;
}

interface BakePlan {
  recipe: AgentRecipe;
  out: string;
  exists: boolean;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  timeoutMs?: number;
}

export async function cmdBake(args: string[]): Promise<number> {
  const opts = parseBakeArgs(args);
  const plan = resolveBakePlan(opts);
  if (plan.dryRun) {
    reportBakeDryRun(plan);
    return 0;
  }
  if (plan.exists && !plan.force) {
    reportBakeReuse(plan);
    return 0;
  }
  await runBake(plan).catch(handleError);
  return 0;
}

type BakeFlagConsumer = (args: string[], index: number, arg: string, opts: BakeOptions) => number;

const BAKE_FLAG_CONSUMERS: Array<[(arg: string) => boolean, BakeFlagConsumer]> = [
  [isFlag("--force"), consumeBooleanFlag("force")],
  [isFlag("--dry-run"), consumeBooleanFlag("dryRun")],
  [isFlag("--json"), consumeBooleanFlag("json")],
  [isStringFlag("--out"), consumeOutFlag],
  [isStringFlag("--timeout-ms"), consumeTimeoutFlag],
];

export function parseBakeArgs(args: string[]): BakeOptions {
  const opts: BakeOptions = { force: false, dryRun: false, json: false };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const nextIndex = tryConsumeBakeFlag(args, i, arg, opts);
    if (nextIndex !== undefined) {
      i = nextIndex;
    } else {
      addBakePositional(positional, arg);
    }
  }
  opts.recipe = parseSingleRecipePositional(positional);
  return opts;
}

function tryConsumeBakeFlag(
  args: string[],
  index: number,
  arg: string,
  opts: BakeOptions,
): number | undefined {
  const entry = BAKE_FLAG_CONSUMERS.find(([matches]) => matches(arg));
  return entry?.[1](args, index, arg, opts);
}

function addBakePositional(positional: string[], arg: string): void {
  if (arg.startsWith("--")) {
    die(`unknown bake flag: ${arg}`);
  }
  positional.push(arg);
}

function parseSingleRecipePositional(positional: string[]): AgentRecipeName {
  if (positional.length !== 1) {
    die(bakeUsage());
  }
  return parseRecipeName(positional[0]!);
}

function isFlag(name: string): (arg: string) => boolean {
  return (arg) => arg === name;
}

function isStringFlag(name: string): (arg: string) => boolean {
  return (arg) => arg === name || arg.startsWith(`${name}=`);
}

function consumeBooleanFlag(key: "force" | "dryRun" | "json"): BakeFlagConsumer {
  return (_args, index, _arg, opts) => {
    opts[key] = true;
    return index;
  };
}

function consumeOutFlag(args: string[], index: number, arg: string, opts: BakeOptions): number {
  const { value, nextIndex } = stringFlagValue(args, index, arg, "--out");
  opts.out = value;
  return nextIndex;
}

function consumeTimeoutFlag(args: string[], index: number, arg: string, opts: BakeOptions): number {
  const { value, nextIndex } = stringFlagValue(args, index, arg, "--timeout-ms");
  opts.timeoutMs = parsePositiveInteger(value, "--timeout-ms");
  return nextIndex;
}

function stringFlagValue(
  args: string[],
  index: number,
  arg: string,
  name: string,
): { value: string; nextIndex: number } {
  const value = arg === name ? args[index + 1] : arg.slice(`${name}=`.length);
  if (!value) {
    die(`${name} requires a value`);
  }
  return { value, nextIndex: arg === name ? index + 1 : index };
}

function parsePositiveInteger(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    die(`${flag}: expected a positive integer, got '${value}'`);
  }
  return n;
}

function parseRecipeName(value: string): AgentRecipeName {
  if (value === "pi" || value === "claude") {
    return value;
  }
  die(`unknown bake recipe: ${value}\n${bakeUsage()}`);
}

export function resolveBakePlan(opts: BakeOptions): BakePlan {
  const recipe = RECIPES[opts.recipe ?? "pi"];
  const out = resolve(opts.out ?? defaultBakeOut(recipe.name));
  return {
    recipe,
    out,
    exists: existsSync(out),
    force: opts.force,
    dryRun: opts.dryRun,
    json: opts.json,
    timeoutMs: opts.timeoutMs,
  };
}

function defaultBakeOut(recipe: AgentRecipeName): string {
  return resolve(homedir(), ".machinen", "recipes", `${recipe}.tar.gz`);
}

function bakeUsage(): string {
  return (
    "usage: machinen bake <pi|claude> [--out <tar.gz>] [--force] " +
    "[--timeout-ms <ms>] [--dry-run] [--json]"
  );
}

function reportBakeDryRun(plan: BakePlan): void {
  if (plan.json) {
    emitJson(bakeEnvelope(plan, { dryRun: true, reused: false }));
    return;
  }
  process.stdout.write(
    `would bake ${plan.recipe.displayName} agent VM image to ${plan.out}` +
      (plan.exists && !plan.force ? " (already exists; pass --force to rebuild)" : "") +
      "\n",
  );
}

function reportBakeReuse(plan: BakePlan): void {
  if (plan.json) {
    emitJson(
      bakeEnvelope(plan, { dryRun: false, reused: true, sizeBytes: statSync(plan.out).size }),
    );
    return;
  }
  process.stdout.write(
    `${plan.recipe.displayName} agent VM image already exists: ${plan.out}\n` +
      "pass --force to rebuild it\n",
  );
}

async function runBake(plan: BakePlan): Promise<void> {
  mkdirSync(dirname(plan.out), { recursive: true });
  process.stderr.write(`machinen bake: baking ${plan.recipe.displayName} agent VM image\n`);
  process.stderr.write(`machinen bake: output ${plan.out}\n`);
  const started = Date.now();
  const result = await provision({
    install: async (vm) => installAgentRecipe(vm, plan.recipe),
    cmd: ["/bin/sleep", "infinity"],
    out: plan.out,
    timeoutMs: plan.timeoutMs ?? 20 * 60_000,
    onLog: bakeLogPrinter,
  });
  if (plan.json) {
    emitJson(
      bakeEnvelope(plan, {
        dryRun: false,
        reused: false,
        sizeBytes: result.sizeBytes,
        elapsedMs: result.elapsedMs,
      }),
    );
    return;
  }
  process.stdout.write(
    `baked ${plan.recipe.displayName} agent VM image: ${result.imagePath}\n` +
      `size: ${formatBytes(result.sizeBytes)}  elapsed: ${formatMs(Date.now() - started)}\n`,
  );
}

async function installAgentRecipe(
  vm: {
    exec(cmd: string): Promise<unknown>;
    writeFile(path: string, contents: string, opts?: { mode?: number }): Promise<void>;
  },
  recipe: AgentRecipe,
): Promise<void> {
  await vm.exec("export DEBIAN_FRONTEND=noninteractive; apt-get update");
  await vm.exec(
    "export DEBIAN_FRONTEND=noninteractive; " +
      "apt-get install -y --no-install-recommends " +
      [
        "bash",
        "ca-certificates",
        "curl",
        "git",
        "jq",
        "less",
        "openssh-client",
        "ripgrep",
        "unzip",
        "vim-tiny",
        "xz-utils",
      ].join(" "),
  );
  await installNode22(vm);
  await vm.exec(`npm install -g ${recipe.npmPackage}`);
  await vm.exec(
    `ln -sf /opt/fnm/aliases/default/bin/${recipe.binary} /usr/local/bin/${recipe.binary}`,
  );
  await vm.exec(`command -v ${recipe.binary}`);
  await vm.writeFile("/etc/profile.d/machinen-agent-vm.sh", profileScript(recipe), {
    mode: 0o644,
  });
  await vm.exec(
    "touch /root/.bashrc && " +
      "printf '\n[ -f /etc/profile.d/machinen-agent-vm.sh ] && . /etc/profile.d/machinen-agent-vm.sh\n' >> /root/.bashrc",
  );
  await vm.writeFile("/etc/motd", motd(recipe), { mode: 0o644 });
}

async function installNode22(vm: { exec(cmd: string): Promise<unknown> }): Promise<void> {
  await vm.exec(
    "curl -fsSL https://fnm.vercel.app/install | " +
      "bash -s -- --install-dir /opt/fnm --skip-shell",
  );
  await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm install 22");
  await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm default 22");
  await vm.exec("ln -sf /opt/fnm/aliases/default/bin/* /usr/local/bin/");
  await vm.exec("node --version && npm --version");
}

function profileScript(recipe: AgentRecipe): string {
  return `# Installed by machinen bake ${recipe.name}.
export PATH="/usr/local/bin:$PATH"
export EDITOR="${"${EDITOR:-vim}"}"

if [ -d /mnt/workspace ] && [ "$PWD" = "$HOME" ]; then
  cd /mnt/workspace
fi
${recipe.bootstrap}${recipe.aliases}`;
}

function motd(recipe: AgentRecipe): string {
  return `Machinen ${recipe.displayName} agent VM

This VM is meant to run in the background and be reattached:

  machinen attach <name>

Mount your project at /mnt/workspace when you boot:

  machinen boot --name agent --detach --mount-live "$PWD:/mnt/workspace:rw" <image>

Then reconnect any time with the same attach command.
`;
}

function bakeLogPrinter(evt: LogEvent): void {
  if (evt.source === "phase") {
    process.stderr.write(`machinen bake: ${evt.kind} completed in ${formatMs(evt.totalMs)}\n`);
    return;
  }
  if (evt.source === "exec-stdout" || evt.source === "exec-stderr") {
    process.stderr.write(evt.chunk);
  }
}

function bakeEnvelope(
  plan: BakePlan,
  result: { dryRun: boolean; reused: boolean; sizeBytes?: number; elapsedMs?: number },
): Record<string, unknown> {
  return {
    schema_version: 1,
    recipe: plan.recipe.name,
    image: plan.out,
    dry_run: result.dryRun,
    reused: result.reused,
    exists: plan.exists,
    size_bytes: result.sizeBytes ?? null,
    elapsed_ms: result.elapsedMs ?? null,
  };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatBytes(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
}
