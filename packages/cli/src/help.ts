import { VERSION } from "./base-assets.ts";

export function printHelp(): void {
  process.stdout.write(
    `machinen ${VERSION}\n` +
      `\n` +
      `Usage:\n` +
      `  machinen boot [opts] -- <cmd>                  Boot a microVM and run <cmd>\n` +
      `    --name <name>                                Register under a unique human name\n` +
      `                                                 (path-shaped allowed: 'a/b/c').\n` +
      `    --snapshot <path>                            Attach <path> as /dev/vda — scratch\n` +
      `                                                 disk for a future vm.snapshot().\n` +
      `    --mount <host-dir>:<guest-path>              Expose one host dir inside the guest\n` +
      `                                                 (path under /mnt/; copy-once).\n` +
      `    --mount-live <host-dir>:<guest-path>[:<mode>]\n` +
      `                                                 Live-share a host dir over FUSE.\n` +
      `                                                 Guest reads stream in on demand; no\n` +
      `                                                 copy at boot. mode is 'rw' (default,\n` +
      `                                                 write-through) or 'ro' (read-only).\n` +
      `    --env KEY=VALUE                              Set an env var inside the guest.\n` +
      `    --cwd <abs-path>                             Start the guest cmd in this directory\n` +
      `                                                 (must be absolute).\n` +
      `    --nested                                     Expose arm64 EL2 / /dev/kvm to the guest\n` +
      `                                                 when the host supports it.\n` +
      `    -p <hostPort>:<guestPort>                    Forward host:hostPort → guest:guestPort.\n` +
      `\n` +
      `  machinen move scan <vm> [--json]             Scan a VM's PID graph state classes.\n` +
      `  machinen move save <vm> <pid> <out-dir> [--issue]\n` +
      `                                                 Write a VM move descriptor or refusal evidence.\n` +
      `  machinen move load <vm> <bundle-dir> [--json]\n` +
      `                                                 Validate a move descriptor against a VM.\n` +
      `\n` +
      `  machinen restore <snap-dir> [--image <tar.gz>] [--name <name>] [-p ...]\n` +
      `                              [--mount-live <host>:<guest>[:<mode>]]\n` +
      `                                                 Restore a VM from a snapshot bundle.\n` +
      `                                                 Anonymous restores auto-name as\n` +
      `                                                 <source>/<pid>. Pass --image with the\n` +
      `                                                 same tarball used to boot the source VM\n` +
      `                                                 when the workload references files\n` +
      `                                                 outside the base rootfs (e.g. node).\n` +
      `                                                 -p <hostPort>:<guestPort> forwards a host\n` +
      `                                                 port into the restored VM; forwards are\n` +
      `                                                 NOT inherited from the source (host ports\n` +
      `                                                 are global), so pick host ports nothing\n` +
      `                                                 else is binding.\n` +
      `  machinen list  (alias: ls, ps)                 List running VMs (PID, NAME, UP,\n` +
      `                                                 PORTS, FORKED-FROM). Pass --json for\n` +
      `                                                 a structured payload on stdout.\n` +
      `\n` +
      `  Targeting a running VM:\n` +
      `    Pass the name or pid as the first positional arg.\n` +
      `    Digits-only is interpreted as a pid; everything else as a name.\n` +
      `\n` +
      `  machinen exec     <name|pid> [--tty] -- <cmd>\n` +
      `                                                 Run a command in a running VM. Pass\n` +
      `                                                 --tty for a real PTY session — needed\n` +
      `                                                 for an interactive shell, vim, htop,\n` +
      `                                                 or anything that wants job control.\n` +
      `                                                 Without --tty stdio is line-buffered\n` +
      `                                                 pipes (good for one-shot commands).\n` +
      `                                                 Example:\n` +
      `                                                   machinen exec <name|pid> --tty -- bash -i\n` +
      `  machinen attach   <name|pid> [--shell <c>]    Drop into an interactive PTY shell\n` +
      `                                                 in the running VM (default \`bash -i\`).\n` +
      `                                                 \`cd\`, env vars, history, job control\n` +
      `                                                 and full-screen TUIs all work. Exit\n` +
      `                                                 the shell (Ctrl-D) to detach.\n` +
      `  machinen snapshot <name|pid> <out-dir> [--keep-alive]\n` +
      `  machinen snapshot <name|pid> --out <dir> [--keep-alive]\n` +
      `                                                 Checkpoint a running VM into <d>.\n` +
      `                                                 Node workloads are detected inside the VM;\n` +
      `                                                 no Node-only snapshot selector is needed.\n` +
      `                                                 Default vmstate snapshots are incremental\n` +
      `                                                 and non-destructive. CRIU snapshots stay\n` +
      `                                                 non-incremental; --keep-alive leaves them\n` +
      `                                                 running and closes inherited TCP sockets.\n` +
      `  machinen fork     <name|pid> [--new-name <n>] [--out-dir <d>] [--tcp-keep] [--detach]\n` +
      `                    [-p ...] [--mount ...] [--mount-live ...] [--env KEY=VALUE]...\n` +
      `                    [--cwd <abs>] [--memory <mib>]\n` +
      `                                                 Snapshot the source live (it keeps\n` +
      `                                                 running) and restore into a sibling VM,\n` +
      `                                                 dropping the caller into the fork's\n` +
      `                                                 interactive console. Pass --detach to\n` +
      `                                                 hand the fork off and return immediately\n` +
      `                                                 (CI / scripted use).\n` +
      `                                                 Without --out-dir, the bundle is\n` +
      `                                                 ephemeral and removed when the fork exits.\n` +
      `                                                 -p <hostPort>:<guestPort> forwards a host\n` +
      `                                                 port into the fork; host forwards are NOT\n` +
      `                                                 inherited from the source (host ports are\n` +
      `                                                 global), so pick a host port the source\n` +
      `                                                 isn't already using.\n` +
      `                                                 The boot-shaped flags (--mount,\n` +
      `                                                 --mount-live, --env, --cwd, --memory)\n` +
      `                                                 take effect on the forked sibling, not\n` +
      `                                                 the source.\n` +
      `  machinen repl     <name|pid>                   Per-line exec REPL: each line is a\n` +
      `                                                 fresh one-shot \`exec\`, no persistent\n` +
      `                                                 state. Useful for piping a script of\n` +
      `                                                 one-liners; for an interactive shell\n` +
      `                                                 use \`machinen attach\` instead.\n` +
      `\n` +
      `  machinen install                               Pre-fetch the current-tag base assets\n` +
      `    --version <tag>                              Pin to a specific release tag\n` +
      `  machinen agent-context                         Versioned JSON describing every command,\n` +
      `                                                 flag, and exit code. Source-of-truth\n` +
      `                                                 for agent introspection.\n` +
      `  machinen feedback "<text>"                     Record a friction note locally\n` +
      `                                                 (~/.machinen/feedback.jsonl). With\n` +
      `                                                 MACHINEN_FEEDBACK_ENDPOINT set, also\n` +
      `                                                 POSTs upstream. \`--list\` prints recent\n` +
      `                                                 entries.\n` +
      `  machinen completion <shell>                    Emit shell completion (bash|zsh|fish)\n` +
      `  machinen --version | -h                        Print version / help\n` +
      `\n` +
      `Global flags:\n` +
      `  --json                                         Emit machine-readable JSON to stdout.\n` +
      `                                                 Supported on: list, gc, install,\n` +
      `                                                 snapshot, stop, fork --detach,\n` +
      `                                                 boot --detach, move, feedback,\n` +
      `                                                 agent-context.\n` +
      `  --dry-run                                      Preview a mutating command without\n` +
      `                                                 side effects. Supported on: gc, stop,\n` +
      `                                                 snapshot.\n` +
      `\n` +
      `Examples:\n` +
      `  machinen boot --name worker -- node server.js\n` +
      `  machinen ls\n` +
      `  machinen exec worker -- ps aux                       # one-off command\n` +
      `  machinen exec worker --tty -- bash -i                # interactive shell w/ job control\n` +
      `  machinen attach worker                              # persistent interactive shell\n` +
      `  machinen exec worker --tty -- vim /etc/passwd        # full-screen TUI in a PTY\n` +
      `  machinen snapshot worker ./warm                      # CRIU snapshot bundle\n` +
      `  machinen restore ./warm\n` +
      `  machinen move scan worker --json\n` +
      `  machinen move save worker 1234 ./move.json --issue\n` +
      `  machinen move load worker ./move.json --json\n` +
      `\n` +
      `Environment:\n` +
      `  MACHINEN_VMM                             Override the VMM binary path (dev)\n` +
      `  MACHINEN_ASSETS_DIR                      Use base assets from this directory\n` +
      `                                           instead of the cache / GH Releases\n` +
      `  MACHINEN_GUEST_ARCH                      Guest asset arch: arm64 or amd64\n` +
      `  MACHINEN_SNAPSHOT_ENGINE                Snapshot engine: vmstate (default),\n` +
      `                                           criu, or portable (legacy portable routes\n` +
      `                                           refuse; use machinen move for cross-ISA)\n` +
      `  MACHINEN_REGISTRY_DIR                    Override registry location (default\n` +
      `                                           ~/.machinen/vms)\n` +
      `\n` +
      `Cache:\n` +
      `  ~/.machinen/<tag>/bases/debian-arm64/ or debian-amd64/\n`,
  );
}
