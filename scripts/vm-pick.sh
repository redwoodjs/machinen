#!/usr/bin/env bash
# vm-pick — fuzzy-pick an open issue/PR, CoW-clone the repo into a sibling
#           "<reponame>.machinen/" tree, then exec `pnpm vm` inside the
#           clone. Reuses an existing clone for the same issue/PR.
#
# Why CoW clones instead of git worktrees: a worktree's `.git` is a *file*
# pointing to a host path that doesn't exist inside the guest, so `git`
# inside the VM breaks. A `cp -c -R` reflink (APFS / btrfs / xfs) gives
# the clone its own `.git` directory, instant and disk-cheap, with full
# git/gh functionality inside the guest.

set -euo pipefail

# --refresh re-copies boot-glue files (vm.ts, provision.ts) from the
# canonical checkout over the clone's versions before booting, so a
# clone made before a fix to those files picks up the new behavior
# without having to delete and re-clone. Anything else in the clone is
# untouched.
WINDOW=0
EXPLICIT_NUM=""
SCRATCH=0
for arg in "$@"; do
  case "$arg" in
    --refresh) ;; # boot-glue resync is now unconditional; flag kept as a no-op for muscle memory
    --window)  WINDOW=1 ;;
    --scratch|scratch) SCRATCH=1 ;;
    -h|--help)
      echo "usage: pnpm vm-pick [--window] [--scratch | <number>]" >&2
      echo "  <number>   skip the picker and jump to this issue or PR (e.g. 177 or #177)" >&2
      echo "  --scratch  skip the picker and create a fresh throwaway clone" >&2
      echo "             (no issue/PR ref, drops into bash instead of auto-claude)" >&2
      echo "  --window   spawn the boot in a new Ghostty window instead of the current TTY" >&2
      echo "" >&2
      echo "  vm.ts + provision.ts are always re-synced from canonical so stale clones" >&2
      echo "  pick up boot-glue fixes automatically." >&2
      exit 0
      ;;
    \#*|[0-9]*)
      candidate=${arg#\#}
      if [[ -n "$EXPLICIT_NUM" ]]; then
        echo "vm-pick: more than one number passed (have $EXPLICIT_NUM, also got $arg)" >&2
        exit 1
      fi
      if [[ ! "$candidate" =~ ^[0-9]+$ ]]; then
        echo "vm-pick: not a valid issue/PR number: $arg" >&2
        exit 1
      fi
      EXPLICIT_NUM=$candidate
      ;;
    *)
      echo "vm-pick: unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$EXPLICIT_NUM" ]] && (( SCRATCH )); then
  echo "vm-pick: --scratch and an explicit number are mutually exclusive" >&2
  exit 1
fi

if [[ -z "$EXPLICIT_NUM" ]] && (( ! SCRATCH )) && ! command -v fzf >/dev/null 2>&1; then
  echo "vm-pick: fzf is required (or pass an explicit number / --scratch). Install with: brew install fzf" >&2
  exit 1
fi
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "vm-pick: not inside a git repository." >&2
  exit 1
fi

# Anchor on the canonical checkout. From a clone, redirect there.
HERE=$(pwd)
if [[ -f "$HERE/.machinen-vm/origin" ]]; then
  MAIN_REPO=$(<"$HERE/.machinen-vm/origin")
  MAIN_REPO=${MAIN_REPO%$'\n'}
  echo "vm-pick: redirecting to canonical at $MAIN_REPO" >&2
else
  MAIN_REPO=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
fi
PARENT_DIR=$(dirname "$MAIN_REPO")
REPO_NAME=$(basename "$MAIN_REPO")
CLONES_ROOT="${PARENT_DIR}/${REPO_NAME}.machinen"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

if (( SCRATCH )); then
  kind=scratch
  num=$(date +%Y%m%dT%H%M%S)
  title="scratch"
elif [[ -n "$EXPLICIT_NUM" ]]; then
  # Resolve directly. `gh issue view` refuses PR numbers and vice
  # versa, so try issue first, then PR. State filter is intentionally
  # absent — we want closed/merged refs to work too if the user asks.
  if title=$(cd "$MAIN_REPO" && gh issue view "$EXPLICIT_NUM" --json title -q .title 2>/dev/null) \
       && [[ -n "$title" ]]; then
    kind=issue
  elif title=$(cd "$MAIN_REPO" && gh pr view "$EXPLICIT_NUM" --json title -q .title 2>/dev/null) \
         && [[ -n "$title" ]]; then
    kind=pr
  else
    echo "vm-pick: no issue or PR #$EXPLICIT_NUM in $(basename "$MAIN_REPO")" >&2
    exit 1
  fi
  num=$EXPLICIT_NUM
else
  (cd "$MAIN_REPO" && gh issue list --state open --limit 100 --json number,title,url,labels) \
    > "$tmpdir/issues.json" 2>"$tmpdir/issues.err" &
  issues_pid=$!
  (cd "$MAIN_REPO" && gh pr list --state open --limit 100 --json number,title,url,labels) \
    > "$tmpdir/prs.json" 2>"$tmpdir/prs.err" &
  prs_pid=$!
  wait "$issues_pid"; issues_rc=$?
  wait "$prs_pid";    prs_rc=$?

  if (( issues_rc != 0 )) || (( prs_rc != 0 )); then
    echo "vm-pick: gh failed:" >&2
    (( issues_rc != 0 )) && { echo "  issues:" >&2; sed 's/^/    /' "$tmpdir/issues.err" >&2; }
    (( prs_rc    != 0 )) && { echo "  prs:"    >&2; sed 's/^/    /' "$tmpdir/prs.err"    >&2; }
    exit 1
  fi

  # kind \t number \t title \t url \t labels
  # The synthetic `scratch` row gives users a one-keystroke escape
  # hatch when they want a fresh clone but aren't tied to an
  # issue/PR. Selecting it skips gh checkout / issue-marker writes.
  {
    printf 'scratch\t-\tscratch session (no issue/PR)\t-\t-\n'
    jq -r '.[] | "issue\t\(.number)\t\(.title)\t\(.url)\t\((.labels // []) | map(.name) | join(","))"' < "$tmpdir/issues.json"
    jq -r '.[] | "pr\t\(.number)\t\(.title)\t\(.url)\t\((.labels // []) | map(.name) | join(","))"'    < "$tmpdir/prs.json"
  } > "$tmpdir/combined"

  if [[ ! -s "$tmpdir/combined" ]]; then
    echo "vm-pick: no open issues or PRs." >&2
    exit 1
  fi

  selection=$(
    fzf --delimiter=$'\t' \
        --with-nth='1,2,5,3' \
        --height=40% \
        --reverse \
        --prompt='vm-pick> ' \
        < "$tmpdir/combined"
  ) || exit 1

  IFS=$'\t' read -r kind num title _url _labels <<< "$selection"
  if [[ "$kind" == "scratch" ]]; then
    SCRATCH=1
    num=$(date +%Y%m%dT%H%M%S)
  fi
fi

# Slugify title: lowercase, non-alnum → '-', trim, cap at 40 chars.
slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' \
  | cut -c1-40 \
  | sed -E 's/-+$//')

if (( SCRATCH )); then
  CLONE_DIR="${CLONES_ROOT}/scratch-${num}"
else
  CLONE_DIR="${CLONES_ROOT}/${num}-${kind}-${slug}"
fi

if [[ -d "$CLONE_DIR" ]]; then
  echo "vm-pick: reusing existing clone at $CLONE_DIR" >&2
else
  echo "vm-pick: creating CoW clone at $CLONE_DIR" >&2
  mkdir -p "$CLONES_ROOT"
  # Single clonefile(2) syscall on the source dir clones the whole tree
  # in the kernel — ~10x faster than `cp -c -R`, which walks userspace
  # and pays per-file metadata overhead for ~42k files. Build the helper
  # on first use; it's macOS-arm64-only and intentionally not checked in.
  SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  CLONEFILE_BIN="$SCRIPT_DIR/clonefile"
  CLONEFILE_SRC="$SCRIPT_DIR/clonefile.zig"
  if [[ ! -x "$CLONEFILE_BIN" ]] || [[ "$CLONEFILE_SRC" -nt "$CLONEFILE_BIN" ]]; then
    if command -v zig >/dev/null 2>&1; then
      echo "vm-pick: building clonefile helper..." >&2
      (cd "$SCRIPT_DIR" && zig build-exe -O ReleaseSmall clonefile.zig >/dev/null)
    else
      echo "vm-pick: zig not found, falling back to cp -c -R (slower)" >&2
      CLONEFILE_BIN=""
    fi
  fi
  if [[ -n "$CLONEFILE_BIN" ]]; then
    "$CLONEFILE_BIN" "$MAIN_REPO" "$CLONE_DIR"
  else
    cp -c -R "$MAIN_REPO" "$CLONE_DIR"
  fi

  if [[ "$kind" == "pr" ]]; then
    (cd "$CLONE_DIR" && gh pr checkout "$num")
  elif [[ "$kind" == "issue" ]]; then
    (cd "$CLONE_DIR" && git checkout -B "${num}-${slug}")
  elif [[ "$kind" == "scratch" ]]; then
    (cd "$CLONE_DIR" && git checkout -B "scratch-${num}")
  fi
fi

# Always re-sync boot-glue from canonical. vm.ts and provision.ts are
# launchers, not user content — stale copies in old clones held back
# fixes (claude auto-launch, /dev/fd-free bootstrap) until users
# remembered --refresh. Treating them as untracked-by-the-clone makes
# the system self-healing: ship a fix to canonical and every clone
# picks it up on next boot.
for f in vm.ts provision.ts; do
  cp -c -f "$MAIN_REPO/$f" "$CLONE_DIR/$f"
done

# Stamp marker files unconditionally — newer fields (issue ref) need
# to land on existing clones too, not just freshly-created ones.
# Scratch clones intentionally omit the issue marker so vm.ts drops
# into bash instead of auto-launching `claude "work on #NNN"`. Also
# remove any stale issue file from a re-used scratch dir.
mkdir -p "$CLONE_DIR/.machinen-vm"
printf '%s\n' "$MAIN_REPO" > "$CLONE_DIR/.machinen-vm/origin"
if (( SCRATCH )); then
  rm -f "$CLONE_DIR/.machinen-vm/issue"
else
  printf '%s\n' "$num" > "$CLONE_DIR/.machinen-vm/issue"
fi

cd "$CLONE_DIR"

if (( WINDOW )); then
  # Hand the boot to a fresh Ghostty window. Use a bash -lc wrapper so
  # the child shell picks up PATH (pnpm, node) the same way the user's
  # interactive shell would. printf %q quotes the clone path safely
  # against spaces / shell metacharacters.
  bash_inner="cd $(printf '%q' "$CLONE_DIR") && exec pnpm vm"
  ghostty_command="bash -lc $(printf '%q' "$bash_inner")"

  if [[ "$(uname)" == "Darwin" ]] && [[ -d "/Applications/Ghostty.app" ]]; then
    # Drive Ghostty via its scripting dictionary (Ghostty.sdef ships
    # `new window with configuration { command, initial working directory }`).
    # This works whether Ghostty is already running or cold — `tell
    # application` launches it on demand — and avoids two failure modes
    # of `open -na`: macOS Sequoia silently swallows the new instance's
    # window once Ghostty is already up, and `open -na` accumulates
    # duplicate processes. AppleScript also avoids the Accessibility
    # permission prompt that System Events `keystroke` requires.
    applescript_quote() {
      # Escape backslashes then double quotes for embedding in an AS string.
      printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
    }
    as_command=$(applescript_quote "$ghostty_command")
    as_cwd=$(applescript_quote "$CLONE_DIR")
    rc=0
    osascript >/dev/null <<APPLESCRIPT || rc=$?
tell application "Ghostty"
  activate
  new window with configuration {command:"$as_command", initial working directory:"$as_cwd"}
end tell
APPLESCRIPT
    if (( rc != 0 )); then
      echo "vm-pick: Ghostty AppleScript failed (rc=$rc)." >&2
      echo "         Falling back to \`open -na\`." >&2
      exec open -na "/Applications/Ghostty.app" --args --initial-command="$ghostty_command"
    fi
    exit 0
  elif command -v ghostty >/dev/null 2>&1; then
    exec ghostty +new-window --initial-command="$ghostty_command"
  else
    echo "vm-pick: --window requires Ghostty (https://ghostty.org)" >&2
    exit 1
  fi
fi

exec pnpm vm
