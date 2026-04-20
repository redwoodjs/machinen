# Claude Code in the rootfs — design note + plan

Covers issue #48. "Baking CC into the VM" is small mechanically, but
it can't be verified end-to-end until #46 (network) lands — CC needs
api.anthropic.com to authenticate.

## What "done" actually looks like

Two milestones, one we can ship today, one gated on #46.

### M1 — CC binary lives in the image, `claude --version` works

This is purely a rootfs-build change. Doesn't need virtio-net.

Changes:

- Extend `test-fixtures/Dockerfile.node-criu` (or add
  `Dockerfile.cc`) with `RUN npm install -g @anthropic-ai/claude-code`.
- Regenerate the rootfs tarball from the new image.
- Verify: boot the VM, have demo.sh run `claude --version`, see a
  version string on the serial console.

Test (add to `smoke.sh cc-version`): boot with a demo.sh that runs
`claude --version`, grep for the version pattern in the console log.

### M2 — a CC session actually runs — gated on #46

Changes:

- `try.sh cc` mode: writes a demo.sh that does `exec claude` (or
  whatever the interactive entry is).
- Plumb `ANTHROPIC_API_KEY` into the guest. Simplest: read from the
  host env at boot time, append it to the kernel command line in
  the DTB (or use an init arg). Do not bake the key into the image.
- Run interactively via the stdin thread we already have (PL011 RX).

Test: skip the smoke version (can't assume a live API key in CI).
Manual test doc in README.

## Decisions worth recording early

- **Global npm install vs local** — global makes the entry point
  `claude` rather than `npx claude-code`. Smaller UX, bigger image.
  Going with global.
- **Image size** — expect the rootfs to grow from ~300 MB to ~500
  MB. initramfs.cpio doubles. Still fits in guest RAM fine.
- **API key plumbing** — kernel cmdline is public inside the guest
  (anyone with root can read `/proc/cmdline`). That's fine: inside
  a single-tenant sandbox, you're already trusting whoever boots
  the VM. Once we have virtio-fs (#47 M2) or a host-side agent
  over vsock (#51), switch to injecting at the process level rather
  than the kernel-cmdline level.

## What this proves

Once M2 is working, we've shown the full loop end to end: Zig VMM →
Linux → Node → CC → Anthropic API → back. Everything after (#49 spawn
API, #50 fast restore, #51 multiplex) is about making it repeatable
at volume.
