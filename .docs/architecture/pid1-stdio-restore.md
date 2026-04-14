# Pid 1 Stdio Restore — CRIU Checkpoint Portability

## Problem

Both `machinen restore --local` and `machinen restore --remote` fail with:

```
OCI runtime restore failed: criu failed: type RESTORE errno 0: unknown
```

preceded in `dockerd` logs by:

```
copy stream failed: reading from a closed fifo stream=stdout
copy stream failed: reading from a closed fifo stream=stderr
failed to read init pid file: ... /moby/<cid>/init.pid: no such file or directory
```

CRIU's own log ends with `Restore finished successfully. Tasks resumed.` — so CRIU is not the actual failure. The error is downstream in the containerd-shim's stdio plumbing.

Fails identically on:
- local DinD (Alpine, OrbStack kernel 6.17, patched CRIU 4.2)
- remote Hetzner Ubuntu (Linux 6.8, stock CRIU)

Different kernels, different CRIU versions — same symptom. The broken thing travels with the checkpoint.

## Root Cause

The devcontainer CLI's injected wrapper script lets pid 1 inherit dockerd's stdout/stderr pipes. CRIU's `descriptors.json` captures them as anonymous pipe inodes:

```json
["/dev/null", "pipe:[62531]", "pipe:[62532]"]
```

On restore, the new containerd-shim creates **fresh** fifos with different inodes. Runc is supposed to pass `--inherit-fd fd[1]:pipe:[NEW]` so CRIU remaps the restored pid 1's fd 1/2 onto the new fifos. Either runc stopped doing this or the mapping regressed upstream — untracked. The result: restored pid 1 holds dangling references to the dead pipe inodes, the new shim's fifo never gets written to, the shim times out, closes its end, disconnects, `init.pid` never gets written, and dockerd surfaces a useless generic "criu failed".

## Fix

Redirect pid 1's stdio to `/dev/null` before the infinite-sleep loop. `/dev/null` is a durable path (same inode-equivalent on every machine), so `descriptors.json` captures a path any shim can reopen regardless of whether the original shim's fifos still exist.

In `.devcontainer/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/devcontainers/javascript-node:1-22

CMD ["/bin/sh", "-c", "exec </dev/null >/dev/null 2>&1; while sleep 1 & wait $!; do :; done"]
```

In `.devcontainer/devcontainer.json`:

```json
{
  "build": { "dockerfile": "Dockerfile" },
  "overrideCommand": false,
  ...
}
```

`overrideCommand: false` is load-bearing — without it, devcontainer CLI reinjects its own wrapper that brings the pipe stdio back. `build.dockerfile` is required because devcontainer.json has no way to override CMD directly.

### Verification

After `machinen up`, pid 1's fds should all be `/dev/null`:

```
$ docker exec <container> ls -la /proc/1/fd/
lr-x------  0 -> /dev/null
l-wx------  1 -> /dev/null
l-wx------  2 -> /dev/null
```

Restored container after `machinen restore --local` should show the original checkpointed tmux/bash at their captured pids (not fresh ones):

```
$ docker exec <restored> ps -ef
root    1  ... /bin/sh -c exec </dev/null >/dev/null 2>&1; while sleep 1 ...
node  1567  1 ... tmux new-session -d -c / -s machinen   <- preserved pid
node  1568  1567 ... -bash                                  <- preserved pid
```

Preserved pids prove CRIU genuinely restored the process tree rather than just booting a fresh container.

## Things that do NOT fix it

- **Pinning CRIU** — the regression isn't in CRIU; it's in how runc/shim remaps fds post-restore.
- **Stripping `/dev/*` from mountpoints-*.img** — works around a different mount-namespace error but doesn't address the fd/pipe issue.
- **Pinning docker-in-docker image version** — tested, same failure.
- **Using `--tty`** — replaces pipes with a PTY; also captured in descriptors.json and similarly unrestorable across hosts unless you also widen up PTY allocation.

## Debugging tips

CRIU descriptors for pid 1 are extractable from the checkpoint image (`FROM scratch` + `ADD checkpoint.tar`) without decompressing anything:

```bash
docker create --name x <checkpoint-image> /nonexistent
docker cp x:/checkpoint/descriptors.json -
docker rm x
```

If any of the three strings in that JSON array is not a path (i.e. `pipe:[...]`, `socket:[...]`, `anon_inode:[...]`), restore will break on a fresh host.

The containerd-shim's CRIU log is at `/var/lib/docker/containerd/daemon/io.containerd.runtime.v2.task/moby/<cid>/restore.log` inside the docker host (or DinD container). Only written if CRIU gets far enough — a successful-looking log ending in `Restore finished successfully. Tasks resumed.` while dockerd still reports "criu failed" means the failure is in the post-CRIU shim handoff, not CRIU itself.
