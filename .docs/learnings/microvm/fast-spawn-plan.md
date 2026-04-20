# Fast spawn via CRIU restore — design note + plan

Covers issue #50. We already proved the CRIU freeze/restore primitive
works inside the VMM (commit 42ae74f: counter 5 → 9 across a dump +
restore). This note is about turning that primitive into a spawn path
the `@machinen/runtime` package can use.

## The shape of the speedup

A cold boot runs:

1. HVF setup, VMM init — sub-second
2. Linux kernel boot — ~10 s
3. Userspace init, mount /proc etc. — ~100 ms
4. Node starts — ~1 s
5. Node loads Claude Code (first `require`s, heap warm-up) — ~2 s
6. Ready for input

Steps 2–5 are ~13 seconds every time. They're deterministic — nothing
user-specific happens. That's exactly the state CRIU can checkpoint
once, re-use N times: skip straight from step 1 to step 6.

Target: a fresh sandbox goes from `machinen.spawn()` call to "first
stdout byte from the workload" in under 1 second on an M-series Mac.

## Two architectural choices

### Choice A — one VM per sandbox, each restored from snapshot

Each `spawn()` launches a fresh VMM process; that process is given
the CRIU image set and restores the workload instead of booting from
scratch.

Pros:

- Clean isolation between sandboxes — separate guest kernels, separate
  memory, separate networking (when #46 lands).
- No need for process-level namespaces inside the guest.
- Death of one sandbox can't affect others.

Cons:

- VMM startup still takes ~100 ms per sandbox.
- Each VM has its own guest RAM — N sandboxes × guest memory size.
- CRIU restore inside a fresh VM still needs kernel/init to set up
  enough of the environment that restore doesn't find a foreign
  system. So the "skip the kernel boot" savings are partial.

### Choice B — one VM, many processes, fork-by-restore

A single long-running VMM with one guest. Inside, we start from a
checkpoint, and `spawn()` means "tell the guest to `criu restore`
another instance of the warm process."

Pros:

- Guest kernel/init boots once for the whole host process lifetime.
- Much cheaper per-sandbox — just a process start, microseconds to
  milliseconds.
- Shared pagecache, shared memory savings.

Cons:

- One guest kernel = one blast radius. A kernel panic from any
  sandbox kills every sandbox.
- Requires process-level isolation inside the guest (pid namespaces,
  network namespaces, cgroups). Not trivial to orchestrate.
- Host-side supervisor must talk to an in-guest agent over vsock to
  trigger restores. Couples #50 and #51.

### Going with Choice A first

Cleaner isolation wins. Spend the extra 100 ms per sandbox, revisit
if the numbers prove too slow. Choice B is a follow-on milestone if
we ever need sub-10 ms spawn.

## Milestones

### M1 — deterministic warm image

- Pick a freezing point. Probably "Node + CC started, waiting on
  stdin, nothing user-specific opened yet."
- Build a one-shot script that boots cold, drives the guest to
  this point, runs `criu dump`, and archives the image set +
  fs state as a named bundle.
- Store it as a fixture for reuse across spawns.

### M2 — restore-on-spawn

- `@machinen/runtime`'s `spawn({ snapshot: "warm-cc" })` starts the
  VMM with an env hint ("restore from /tmp/images, don't boot"),
  and the guest's init runs `criu restore` instead of the normal
  demo payload.
- Measure: t=0 from `spawn()` to first byte back.
- Iterate until under a second.

### M3 — per-sandbox filesystem

- Each `spawn()` gets its own virtio-blk image (overlay on a shared
  read-only base) so CC's workspace writes don't leak between
  sandboxes.
- Needs #47.

## Risks

- **Restore doesn't like a changed environment.** CRIU is picky
  about open fds, network namespace details, tty state. The
  checkpoint must be done under the same conditions the restore
  will happen in. Expect bring-up pain.
- **io_uring** — we already had to block it with `no-iou` to make
  CRIU dump work. Keep doing that in the warm image.
- **Image size** — a full Node+CC heap dump could be hundreds of MB.
  Compression + lazy restore are options if this becomes a problem.

## What this needs before it can start

- #49 `@machinen/runtime`: the spawn path we're extending. ✓ started.
- #46 virtio-net: the warm image should have already done any
  network init that would cost time on cold boot.
- #47 virtio-blk: per-sandbox filesystems.

So: M1 (warm image) can be mocked up today with our existing tools.
M2 (real integration with `spawn()`) waits on the other two.
