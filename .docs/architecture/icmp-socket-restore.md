# ICMP Socket Restore — Remote CRIU Fix

## Problem

`machinen restore --remote` fails with `criu failed: type RESTORE errno 0: unknown` when the checkpointed container holds an open ICMP ping socket (`AF_INET, SOCK_DGRAM, IPPROTO_ICMP`). The Node.js process opens one of these during startup.

CRIU restore.log shows:

```
1639: inet: Restore: family AF_INET type SOCK_DGRAM proto IPPROTO_ICMP port 10 state TCP_CLOSE src_addr 0.0.0.0
1639: Error (criu/sk-inet.c:896): inet: Can't create inet socket: Permission denied
1639: Error (criu/files.c:1221): Unable to open fd=3 id=0x22
```

## Root Cause

CRIU's restore flow restores file descriptors **before** restoring credentials/capabilities (`restore_one_alive_task()` calls `prepare_fds()` before `restore_creds()`). The restore child must call `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)` to recreate the ping socket.

On Ubuntu 24.04 servers, `net.ipv4.ping_group_range = 1 0` (empty range), meaning only processes with effective `CAP_NET_RAW` can create ICMP ping sockets. CRIU's restore child doesn't have `CAP_NET_RAW` in its effective set at FD-restoration time — CRIU's root task calls `set_opts_cap_eff()` before forking child processes, and `CAP_NET_RAW` is not preserved.

Things that do NOT fix this:

- `--cap-add NET_RAW` on `docker create` — caps are set on the container spec, not on CRIU's internal child process during FD restoration
- `--security-opt apparmor=unconfined` — AppArmor is not involved; checkpoint has no `apparmor.img`

## Fix

In `remoteRestore()` (`src/cloud.mjs`), immediately before `docker start --checkpoint`, temporarily widen `ping_group_range` to allow all GIDs:

```bash
sysctl -w net.ipv4.ping_group_range="0 2147483647"
docker start --checkpoint ...
sysctl -w net.ipv4.ping_group_range="$ORIG_PING_RANGE"
```

This works because the container uses `--network host`, so CRIU's restore child shares the host network namespace — the sysctl applies to it.

## Debugging Tips

Capture the CRIU restore.log before containerd cleans it up — it lives at:

- `/run/containerd/io.containerd.runtime.v2.task/moby/<container-id>/work/restore.log`
- `/tmp/ctrd-checkpoint*/restore.log`
- `<checkpoint-dir>/restore.log`

Poll in a tight loop before running `docker start --checkpoint` and copy on first appearance.

The virtual PID in the restore.log (e.g. `1639`) is CRIU's internal numbering, not the real kernel PID.
