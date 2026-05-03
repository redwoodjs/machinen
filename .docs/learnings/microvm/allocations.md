# microvm allocations audit

NASA Power-of-Ten Rule 3: avoid dynamic allocation in steady-state code.
This file enumerates every `gpa.*` call in `packages/microvm/src/`,
classifies it, and records the rationale where a call survives the
audit.

Categories:

- **(a) one-shot at boot** — runs zero or one times during the VMM's
  lifetime, before the run loop starts (or once after it ends).
- **(b) per-event but bounded** — runs on a discrete event (a guest
  packet, a host connection), but the rate is bounded by external
  pressure and the buffer/list reuses memory after the first few
  events.
- **(c) per-event in a hot loop** — runs in the run loop or on every
  packet/byte. The TigerStyle target is to eliminate these.

| File             | Site                                       | Op                                                                                | Class       | Notes                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------ | --------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot_hvf.zig`   | `loadFixtures`                             | `readAll(kernel)` + `readAll(dtb)`                                                | a           | One read per boot. `LoadedFixtures.deinit` frees both.                                                                                                                                                                                                                                                                          |
| `boot_hvf.zig`   | `allocateAndPopulateRam`                   | `readAll(initrd)`                                                                 | a           | One read per boot when `initrd_path` is set; freed before run loop starts.                                                                                                                                                                                                                                                      |
| `boot_hvf.zig`   | `runLoop` end                              | `gpa.dupe(uart.captured.items)`                                                   | a           | Once per boot, on shutdown. Caller (main.zig / tests) frees.                                                                                                                                                                                                                                                                    |
| `boot_kvm.zig`   | same as boot_hvf                           | same                                                                              | a           | KVM twin; identical lifetimes.                                                                                                                                                                                                                                                                                                  |
| `vsock.zig`      | `parseEnv`                                 | `gpa.allocSentinel(uds_path)` × N entries, `list.append` × N, `list.toOwnedSlice` | a           | Parses `MACHINEN_VSOCK` once at boot. N capped by `parse_env_entries_max` (256). Paths leak for the VMM's life by design.                                                                                                                                                                                                       |
| `vsock.zig`      | `Bridge.create`                            | `gpa.create(Bridge)`                                                              | a           | One bridge per VM. `destroy` frees it.                                                                                                                                                                                                                                                                                          |
| `vsock.zig`      | `Bridge.start`                             | `listeners.append`, `listener_port_idx.append`                                    | a           | One append per inbound port at boot; bounded by the operator-supplied `MACHINEN_VSOCK` map.                                                                                                                                                                                                                                     |
| `vsock.zig`      | `Bridge.runThread` start                   | `gpa.alloc(PollFd, BRIDGE_INITIAL_POLL_CAP)`                                      | a           | One scratch alloc per bridge thread. **#240**: pre-sized to a cap that covers the steady-state pollset, so the realloc path below never fires under normal operation.                                                                                                                                                           |
| `vsock.zig`      | `Bridge.runThread` loop                    | `gpa.realloc(scratch, want)`                                                      | b → never   | Was per-iteration on growth. **#240**: with the pre-sized scratch, this branch is now dead code under normal operation; kept as a safety valve for pathological port-map / connection counts.                                                                                                                                   |
| `vsock.zig`      | `Bridge.startConnection`                   | `conns.append`                                                                    | b           | Per inbound UDS connection. Connection count is host-operator-controlled; ArrayList doubles, so amortised O(1) per `append`.                                                                                                                                                                                                    |
| `vsock.zig`      | `Bridge.dispatchGuestPacket` (REQUEST arm) | `conns.append`                                                                    | b           | Per outbound REQUEST from the guest. Same shape as `startConnection`.                                                                                                                                                                                                                                                           |
| `net_socket.zig` | `NetSocket.connect`                        | `gpa.create(NetSocket)`                                                           | a           | One per VM. `destroy` frees it.                                                                                                                                                                                                                                                                                                 |
| `pl011.zig`      | `pushRx`                                   | `rx_buf.appendSlice(bytes)`                                                       | b           | Per stdin batch (≤ 256 B per batch). Drained as the guest reads DR; bounded in steady state. Stays a `(b)` because non-interactive boots never invoke it.                                                                                                                                                                       |
| `pl011.zig`      | `write` (DR arm)                           | `captured.append(byte)`                                                           | (c) → gated | One append per byte the guest writes to the UART data register. **#240**: `Pl011.capture_enabled` (set false when `Config.unbounded_serial = true`) skips the append entirely in production boots, where main.zig frees the captured buffer unread anyway. Test boots leave it enabled (capped by `Config.capture_bytes` exit). |

## Fixes landed in #240

1. **`pl011.captured.append` → gated by `capture_enabled`.**
   Production boots (set `Config.unbounded_serial = true`) frees
   `Result.serial` immediately on shutdown without reading it (see
   `main.zig`, comment at "result.serial buffer is the same bytes,
   captured for tests — don't re-emit here"). Skipping the append
   eliminates the per-byte `ArrayList` grow on the production hot
   path. The same guest console bytes still echo to host stderr from
   the `handlePl011Mmio` DR arm in both `boot_hvf.zig` and
   `boot_kvm.zig`, so user-visible output is unchanged.

2. **`vsock.Bridge.runThread` scratch pre-sized.**
   The poll set is `1 + listeners + conns`. Pre-allocating to
   `BRIDGE_INITIAL_POLL_CAP = 256` covers every realistic operator
   config (the host UDS map is rarely more than a handful of ports,
   and per-bridge connection counts in production stay in the
   single digits). The `realloc` branch survives as a safety valve
   for pathological cases.

## Out of scope

Switching the entire VMM to a static arena. Not warranted by what we
see here — every survivor is one-shot at boot, bounded by an
operator-supplied config, or a guest-driven event ring that ArrayList
amortises. The remaining `(b)` cases would only become hot under
adversarial workload patterns we don't have evidence of yet.
