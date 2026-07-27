import type { StatusWidget, Workspace, WorkspaceLocation } from "@machinen/desktop-sdk";

import { DesktopState } from "../desktop-state.js";
import type { StatusPublisher } from "../status-publisher.js";
import { remoteShellPath, runWorkspaceProbe } from "../workspace-probe.js";
import { WorkspacePollingService } from "../workspace-polling-service.js";

export { remoteShellPath } from "../workspace-probe.js";

const commitMarker = "---MACHINEN-BRANCH-COMMITS---";
const numstatMarker = "---MACHINEN-BRANCH-NUMSTAT---";
const defaultPollIntervalMilliseconds = 4_000;
const widgetTTLMilliseconds = 10_000;

export interface GitMetrics {
  branch: string;
  commits: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  additionBars: number[];
  deletionBars: number[];
}

interface GitStatusServiceOptions {
  pollIntervalMilliseconds?: number;
  probe?: (location: WorkspaceLocation, signal?: AbortSignal) => Promise<GitMetrics>;
}

function gitProbeScript(directory: string): string {
  return [
    `cd ${directory} || exit 1`,
    "branch=$(/usr/bin/git branch --show-current 2>/dev/null)",
    'if [ -z "$branch" ]; then',
    "  branch=$(/usr/bin/git rev-parse --short HEAD 2>/dev/null) || exit 1",
    "fi",
    "base_ref=$(/usr/bin/git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)",
    'if [ -z "$base_ref" ]; then',
    "  for candidate in origin/main main origin/master master; do",
    '    if /usr/bin/git rev-parse --verify --quiet "$candidate" >/dev/null; then',
    "      base_ref=$candidate",
    "      break",
    "    fi",
    "  done",
    "fi",
    'base=$(/usr/bin/git merge-base HEAD "$base_ref" 2>/dev/null || true)',
    'if [ -z "$base" ]; then',
    "  base=$(/usr/bin/git rev-list --max-parents=0 HEAD 2>/dev/null | /usr/bin/tail -1)",
    "fi",
    "commits=$(/usr/bin/git rev-list --count \"$base\"..HEAD 2>/dev/null || printf '0')",
    `printf '%s\\n${commitMarker}\\n%s\\n${numstatMarker}\\n' "$branch" "$commits"`,
    '/usr/bin/git diff --numstat "$base" 2>/dev/null || true',
    "/usr/bin/git ls-files --others --exclude-standard | while IFS= read -r file; do",
    "  lines=$(/usr/bin/wc -l < \"$file\" 2>/dev/null | /usr/bin/tr -d ' ')",
    '  printf \'%s\\t0\\t%s\\n\' "${lines:-0}" "$file"',
    "done",
  ].join("\n");
}

export function remoteGitProbeCommand(path: string): string {
  return gitProbeScript(remoteShellPath(path));
}

export async function probeGit(
  location: WorkspaceLocation,
  signal?: AbortSignal,
): Promise<GitMetrics> {
  const output = await runWorkspaceProbe(location, gitProbeScript, signal);

  const metrics = parseGitOutput(output);
  if (!metrics) {
    throw new Error(`Git returned an invalid status for ${location.path}`);
  }
  return metrics;
}

export function parseGitOutput(output: string): GitMetrics | undefined {
  const commitSections = output.split(commitMarker);
  if (commitSections.length !== 2) {
    return undefined;
  }
  const changeSections = commitSections[1].split(numstatMarker);
  if (changeSections.length !== 2) {
    return undefined;
  }

  const branch = commitSections[0].trim();
  const commits = Number(changeSections[0].trim());
  if (!branch || !Number.isInteger(commits)) {
    return undefined;
  }

  let additions: number[] = [];
  let deletions: number[] = [];
  for (const line of changeSections[1].split("\n")) {
    if (!line) {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length < 3) {
      continue;
    }
    additions.push(Number(fields[0]) || 0);
    deletions.push(Number(fields[1]) || 0);
  }

  const filesChanged = additions.length;
  if (additions.length === 0) {
    additions = [0];
    deletions = [0];
  }
  const ranked = additions
    .map((addition, index) => ({ addition, deletion: deletions[index] ?? 0 }))
    .sort((left, right) => right.addition + right.deletion - (left.addition + left.deletion))
    .slice(0, 14);

  return {
    branch,
    commits,
    filesChanged,
    additions: additions.reduce((total, value) => total + value, 0),
    deletions: deletions.reduce((total, value) => total + value, 0),
    additionBars: ranked.map(({ addition }) => addition),
    deletionBars: ranked.map(({ deletion }) => deletion),
  };
}

export function formatCompactCount(value: number): string {
  let scaled: number;
  let suffix: string;
  if (value >= 999_500_000) {
    scaled = value / 1_000_000_000;
    suffix = "B";
  } else if (value >= 999_500) {
    scaled = value / 1_000_000;
    suffix = "M";
  } else if (value >= 1_000) {
    scaled = value / 1_000;
    suffix = "K";
  } else {
    return String(value);
  }
  const displayValue = scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  return `${displayValue}${suffix}`;
}

export class GitStatusService extends WorkspacePollingService<GitMetrics> {
  constructor(
    desktop: StatusPublisher,
    state: DesktopState,
    options: GitStatusServiceOptions = {},
  ) {
    super(state, {
      name: "Git status service",
      pollIntervalMilliseconds: options.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds,
      probe: options.probe ?? probeGit,
      publish: (workspace, git) => desktop.status.set(gitStatusWidget(workspace, git)),
    });
  }
}

function gitStatusWidget(workspace: Workspace, git: GitMetrics): StatusWidget {
  return {
    id: "machinen.git",
    scope: { kind: "workspace", id: workspace.id },
    placement: "right",
    kind: "sparkline",
    label: git.branch,
    value: `+${formatCompactCount(git.additions)} −${formatCompactCount(git.deletions)}`,
    tone: git.filesChanged === 0 ? "good" : "attention",
    tooltip: [
      `${git.commits} commits · ${git.filesChanged} files`,
      `+${git.additions} additions · −${git.deletions} deletions`,
    ].join("\n"),
    priority: 90,
    ttlMilliseconds: widgetTTLMilliseconds,
    graphStyle: "bars",
    samples: git.additionBars,
    secondarySamples: git.deletionBars,
  };
}
