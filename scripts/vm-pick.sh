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
REFRESH=0
WINDOW=0
EXPLICIT_NUM=""
for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=1 ;;
    --window)  WINDOW=1 ;;
    -h|--help)
      echo "usage: pnpm vm-pick [--refresh] [--window] [<number>]" >&2
      echo "  <number>   skip the picker and jump to this issue or PR (e.g. 177 or #177)" >&2
      echo "  --refresh  re-sync vm.ts + provision.ts from canonical into the chosen clone" >&2
      echo "  --window   spawn the boot in a new Ghostty window instead of the current TTY" >&2
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

if [[ -z "$EXPLICIT_NUM" ]] && ! command -v fzf >/dev/null 2>&1; then
  echo "vm-pick: fzf is required (or pass an explicit number). Install with: brew install fzf" >&2
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

if [[ -n "$EXPLICIT_NUM" ]]; then
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
  (cd "$MAIN_REPO" && gh issue list --state open --limit 100 --json number,title,url) \
    > "$tmpdir/issues.json" 2>"$tmpdir/issues.err" &
  issues_pid=$!
  (cd "$MAIN_REPO" && gh pr list --state open --limit 100 --json number,title,url) \
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

  # kind \t number \t title \t url
  {
    jq -r '.[] | "issue\t\(.number)\t\(.title)\t\(.url)"' < "$tmpdir/issues.json"
    jq -r '.[] | "pr\t\(.number)\t\(.title)\t\(.url)"'    < "$tmpdir/prs.json"
  } > "$tmpdir/combined"

  if [[ ! -s "$tmpdir/combined" ]]; then
    echo "vm-pick: no open issues or PRs." >&2
    exit 1
  fi

  selection=$(
    fzf --delimiter=$'\t' \
        --with-nth='1,2,3' \
        --height=40% \
        --reverse \
        --prompt='vm-pick> ' \
        < "$tmpdir/combined"
  ) || exit 1

  IFS=$'\t' read -r kind num title _url <<< "$selection"
fi

# Slugify title: lowercase, non-alnum → '-', trim, cap at 40 chars.
slug=$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' \
  | cut -c1-40 \
  | sed -E 's/-+$//')

CLONE_DIR="${CLONES_ROOT}/${num}-${kind}-${slug}"

if [[ -d "$CLONE_DIR" ]]; then
  echo "vm-pick: reusing existing clone at $CLONE_DIR" >&2
  if (( REFRESH )); then
    echo "vm-pick: --refresh: re-syncing vm.ts + provision.ts from canonical" >&2
    for f in vm.ts provision.ts; do
      cp -c -f "$MAIN_REPO/$f" "$CLONE_DIR/$f"
    done
  fi
else
  echo "vm-pick: creating CoW clone at $CLONE_DIR" >&2
  mkdir -p "$CLONES_ROOT"
  # APFS reflink on macOS. -c is the macOS clone flag; on Linux use
  # `cp --reflink=auto` instead (this script targets Darwin).
  cp -c -R "$MAIN_REPO" "$CLONE_DIR"

  if [[ "$kind" == "pr" ]]; then
    (cd "$CLONE_DIR" && gh pr checkout "$num")
  else
    (cd "$CLONE_DIR" && git checkout -B "${num}-${slug}")
  fi
fi

# Stamp marker files unconditionally — newer fields (issue ref) need
# to land on existing clones too, not just freshly-created ones.
mkdir -p "$CLONE_DIR/.machinen-vm"
printf '%s\n' "$MAIN_REPO" > "$CLONE_DIR/.machinen-vm/origin"
printf '%s\n' "$num" > "$CLONE_DIR/.machinen-vm/issue"

cd "$CLONE_DIR"

if (( WINDOW )); then
  # Hand the boot to a fresh Ghostty window. Use a bash -lc wrapper so
  # the child shell picks up PATH (pnpm, node) the same way the user's
  # interactive shell would. printf %q quotes the clone path safely
  # against spaces / shell metacharacters.
  init_cmd="cd $(printf '%q' "$CLONE_DIR") && exec pnpm vm"
  wrapped="bash -lc $(printf '%q' "$init_cmd")"
  # Prefer `open -na` on macOS — Ghostty's `+new-window` IPC action
  # is gated behind a build flag and not present in the stable
  # release, so it errors with "+new-window is not supported on this
  # platform" on a vanilla install. `open -na` always works and just
  # costs one extra Ghostty process per window (one VM == one
  # session is what we want here anyway).
  if [[ "$(uname)" == "Darwin" ]] && [[ -d "/Applications/Ghostty.app" ]]; then
    exec open -na "/Applications/Ghostty.app" --args --initial-command="$wrapped"
  elif command -v ghostty >/dev/null 2>&1; then
    exec ghostty +new-window --initial-command="$wrapped"
  else
    echo "vm-pick: --window requires Ghostty (https://ghostty.org)" >&2
    exit 1
  fi
fi

exec pnpm vm
