# #48 M3 — Claude Code API key via vsock, not initramfs

**Before (M2):** the smoke harness wrote
`ANTHROPIC_API_KEY=sk-...` into `rootfs/etc/machinen.env` at build
time, repacked the initramfs, and booted. The key lived inside
every cpio byte we produced. Fine for a one-off local smoke, not
fine for anything remotely shared: snapshots/caches/artifacts all
end up carrying the secret, and rotation means rebuilding the
initramfs.

**After (M3):** the key is pushed into the running guest over the
existing vsock bridge. The initramfs never sees it. Per-boot
injection; rotation is "pass a different env var at spawn."

## How it works

```
host                                        guest
──────────────────────────────────       ──────────────────────────
spawn VMM with                            boot kernel
  MACHINEN_VSOCK=in:1975:/tmp/…           load vsock modules
                                          start secrets-agent.py
                                            bind AF_VSOCK :1975
                                            accept (blocks)
VsockSecrets.send(path, {                 ┐
  ANTHROPIC_API_KEY: "sk-..."             │ UDS → vsock bridge
})                                        │   → REQUEST → accept
  ↓                                       │
  write "ANTHROPIC_API_KEY=sk-...\n"      │
  close                                   ┘
                                          read until EOF
                                          write /etc/machinen.env (0600)
                                          exit 0
cc-session-vsock-demo.sh noticed
the env file appeared → exec
cc-session.sh → claude -p ...
```

## Files

- **`packages/microvm/test-fixtures/secrets-agent.py`** — single-shot
  guest daemon. Binds vsock 1975, accepts one connection, reads
  `KEY=VALUE\n` lines, writes them to `/etc/machinen.env` (0600),
  exits. Skips values with non-identifier keys so a malformed line
  can't inject a second key.
- **`packages/runtime/src/secrets.ts → VsockSecrets`** — host
  client. `VsockSecrets.send(udsPath, { KEY: VALUE })` retries the
  connect (same loop as `VsockWinsize`), writes the entries,
  closes. Rejects any value with a newline before sending.
- **`packages/microvm/test-fixtures/cc-session-vsock-demo.sh`** —
  guest wrapper that loads vsock modules, launches the agent,
  waits up to 60s for `/etc/machinen.env` to appear, then
  `exec`s the unmodified `cc-session.sh`.

## Security properties we assert

The smoke (`smoke.sh cc-session-vsock`) verifies four things:

1. Guest wrote `/etc/machinen.env` from vsock.
2. `cc-session.sh` sourced the injected key.
3. Claude got a model-layer response (auth error counts — proves
   we reached the API).
4. **`rootfs/etc/machinen.env` does not exist after the run.**
   That's the we-didn't-bake-the-key invariant.

If #4 ever fails, the initramfs carries the secret and the whole
point of M3 is blown.

## What M3 intentionally doesn't do

- **Multi-tenant auth.** One guest, one host, one UDS. No
  per-secret ACLs, no HMAC, no nonce. We trust the host filesystem
  permissions on `/tmp/machinen-*.sock`. Multi-tenant would want
  TLS + token auth inside the vsock stream.
- **Secret rotation mid-boot.** The agent is single-shot by
  design — it accepts once, writes the file, exits. Rotating a key
  at runtime means a second channel, or restarting CC under a new
  env.

## Repro

```
ANTHROPIC_API_KEY=sk-... \
  ./packages/microvm/test-fixtures/smoke.sh cc-session-vsock
```

With a fake key it still passes all four assertions because
Anthropic's 401 response matches our "got a model-layer response"
grep. With a real key you see the actual reply from the model.
