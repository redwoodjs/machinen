import { buildAgentContext } from "../agent-context.ts";
import { appendFeedback, feedbackPath, postUpstream, readFeedback } from "../feedback.ts";
import pkg from "../../package.json" with { type: "json" };

const VERSION = pkg.version;

export async function cmdAgentContext(args: string[]): Promise<number> {
  for (const arg of args) {
    if (arg !== "--json") {
      die(`unknown argument: ${arg}`);
    }
  }
  emitJson(buildAgentContext());
  return 0;
}

export async function cmdFeedback(args: string[]): Promise<number> {
  const opts = parseFeedbackOptions(args);
  if (opts.listMode) {
    return listFeedback(opts);
  }
  return recordFeedback(opts);
}

export async function cmdCompletion(args: string[]): Promise<number> {
  const shell = args[0] ?? "bash";
  const completion = completionForShell(shell);
  if (completion === undefined) {
    die(`unsupported shell: ${shell} (expected bash | zsh | fish)`);
  }
  process.stdout.write(completion);
  return 0;
}

interface FeedbackOptions {
  json: boolean;
  listMode: boolean;
  positional: string[];
}

function parseFeedbackOptions(args: string[]): FeedbackOptions {
  const { json, rest } = consumeJsonFlag(args);
  const opts: FeedbackOptions = { json, listMode: false, positional: [] };
  for (const arg of rest) {
    consumeFeedbackArg(opts, arg);
  }
  return opts;
}

function consumeFeedbackArg(opts: FeedbackOptions, arg: string): void {
  if (arg === "--list") {
    opts.listMode = true;
    return;
  }
  if (arg.startsWith("--")) {
    die(`unknown argument: ${arg}`);
  }
  opts.positional.push(arg);
}

function listFeedback(opts: FeedbackOptions): number {
  if (opts.positional.length > 0) {
    die("machinen feedback --list takes no positional arguments");
  }
  const entries = readFeedback();
  if (opts.json) {
    emitJson({ schema_version: 1, entries });
    return 0;
  }
  printFeedbackEntries(entries);
  return 0;
}

function printFeedbackEntries(entries: ReturnType<typeof readFeedback>): void {
  if (entries.length === 0) {
    process.stdout.write("(no feedback recorded)\n");
    return;
  }
  for (const entry of entries) {
    process.stdout.write(`${entry.timestamp}  ${entry.text}\n`);
  }
}

async function recordFeedback(opts: FeedbackOptions): Promise<number> {
  if (opts.positional.length === 0) {
    die('usage: machinen feedback "<text>" | machinen feedback --list');
  }
  const path = feedbackPath();
  const entry = newFeedbackEntry(opts.positional.join(" "));
  appendFeedback(entry, path);
  const upstream = await postUpstream(entry);
  reportFeedbackRecorded(opts, path, upstream);
  return 0;
}

function newFeedbackEntry(text: string): Parameters<typeof appendFeedback>[0] {
  return {
    timestamp: new Date().toISOString(),
    cli_version: VERSION,
    text,
  };
}

function reportFeedbackRecorded(
  opts: FeedbackOptions,
  path: string,
  upstream: Awaited<ReturnType<typeof postUpstream>>,
): void {
  if (opts.json) {
    emitJson({ schema_version: 1, recorded: true, path, upstream_status: upstream.status });
    return;
  }
  process.stdout.write(feedbackRecordedMessage(upstream));
}

function feedbackRecordedMessage(upstream: Awaited<ReturnType<typeof postUpstream>>): string {
  if (upstream.attempted && upstream.status !== null) {
    return `feedback recorded locally and sent upstream (status: ${upstream.status})\n`;
  }
  if (upstream.attempted) {
    return `feedback recorded locally; upstream POST failed: ${upstream.error}\n`;
  }
  return "feedback recorded locally (1 entry)\n";
}

function completionForShell(shell: string): string | undefined {
  return new Map([
    ["bash", BASH_COMPLETION],
    ["zsh", ZSH_COMPLETION],
    ["fish", FISH_COMPLETION],
  ]).get(shell);
}

function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { json, rest };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}

const BASH_COMPLETION = `# machinen bash completion — source this from ~/.bashrc, or:
#   eval "$(machinen completion bash)"
_machinen_completion() {
  local cur prev words cword
  _init_completion || return
  local cmds="boot restore install list ls ps exec snapshot fork attach sessions session-kill repl gc stop feedback agent-context completion --version --help -h -v"
  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
    return
  fi
  case "\${words[1]}" in
    exec|snapshot|fork|attach|sessions|session-kill|repl|stop)
      # First positional after the subcommand is the target.
      if [[ \${cword} -eq 2 ]]; then
        local targets
        targets=$(machinen ls 2>/dev/null | awk 'NR>1{print $1; if ($2!="-") print $2}')
        COMPREPLY=( $(compgen -W "\${targets}" -- "\${cur}") )
        return
      fi
      ;;
    gc)
      COMPREPLY=( $(compgen -W "--dry-run" -- "\${cur}") )
      return
      ;;
  esac
}
complete -F _machinen_completion machinen mn
`;

const ZSH_COMPLETION = `# machinen zsh completion — source this from ~/.zshrc, or:
#   eval "$(machinen completion zsh)"
_machinen() {
  local -a cmds
  cmds=(boot restore install list ls ps exec snapshot fork attach sessions session-kill repl gc stop feedback agent-context completion)
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi
  case "\${words[2]}" in
    exec|snapshot|fork|attach|sessions|session-kill|repl|stop)
      # First positional after the subcommand is the target.
      if (( CURRENT == 3 )); then
        local -a targets
        targets=(\${(f)"$(machinen ls 2>/dev/null | awk 'NR>1{print $1; if ($2!="-") print $2}')"})
        _describe 'target' targets
        return
      fi
      ;;
    gc)
      _describe 'flag' '(--dry-run)'
      return
      ;;
  esac
}
compdef _machinen machinen mn
`;

const FISH_COMPLETION = `# machinen fish completion — source this from your config.fish, or:
#   machinen completion fish | source
set -l cmds boot restore install list ls ps exec snapshot fork attach sessions session-kill repl gc stop feedback agent-context completion
for bin in machinen mn
  complete -c $bin -f -n 'not __fish_seen_subcommand_from $cmds' -a "$cmds"
  for sub in exec snapshot fork attach sessions session-kill repl stop
    # First positional after the subcommand: complete with VM names + pids.
    complete -c $bin -f -n "__fish_seen_subcommand_from $sub" \\
      -a '(machinen ls 2>/dev/null | awk 'NR>1{print $1; if ($2!="-") print $2}')'
  end
  complete -c $bin -f -n "__fish_seen_subcommand_from gc" -l dry-run
end
`;
