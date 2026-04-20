# virtio-vsock — host↔guest stream sockets without a network

Issue: redwoodjs/machinen#44. Currently at M2+: inbound AND outbound
stream connections, credit-based flow control, comma-separated
multi-port config, event-queue carve-out. The bridge is usable for
the real machinen control-plane case (supervisor/checkpoint traffic).

## Why bother when we have slirp?

slirp gives the guest real TCP/IP through the VMM process's sockets.
That's great for "let the guest reach the outside world." But for
host↔guest _control plane_ things — "hey host, I'm idle, checkpoint
me now" or "send this JSON to the agent inside" — you don't want to
route through DHCP/NAT/TCP. You want a point-to-point channel that:

- doesn't fight with guest network config (no `eth0 down` killing it),
- survives IP reconfiguration,
- doesn't need a port mapping the guest can see,
- doesn't hit the TIME_WAIT/ephemeral-port issues a shared NAT has.

virtio-vsock is exactly that. Linux's AF_VSOCK family looks like a
normal socket family to userspace (`socket(AF_VSOCK, SOCK_STREAM, 0)`
etc.), but the wire bytes land in a virtqueue and come out the other
side, bypassing the entire TCP/IP stack on both ends.

## Two-CID model we landed with

virtio-vsock addresses are `(cid, port)`. Every guest has a fixed CID
(>=3). The host always uses CID 2. We store the guest's CID in the
device's config space (a `u64` at offset 0x100) and set it to 3 by
default.

One guest, one host, two CIDs. No multi-tenancy.

## Three queues, not two

Unlike virtio-net (2 queues) or virtio-blk (1 queue), virtio-vsock
has three:

- queue 0 = RX — **guest posts empty buffers, device fills them**
- queue 1 = TX — **guest posts full buffers for device to read**
- queue 2 = event — rarely used; only kicks on transport reset

The RX/TX asymmetry bit me. Our generic `virtio.Device` request-handler
path auto-drains the avail ring on every `notify()`, assuming the
driver is pushing work. For virtio-vsock's queue 0 that's the wrong
mental model: the driver is pushing empty buffers we fill later, not
work we should consume. Without a carveout we'd "consume" each new
RX buffer with a zero-length used entry, meaning our `injectRx` would
always find `last_avail_idx == avail.idx` (we ate them all) and fail.

Fix: added `skip_notify_queues: u32` bitmap on `virtio.Device`. The
vsock device sets bit 0. Queue 0 kicks are ignored; the bridge
consumes avail entries on demand when it has an RX packet to deliver.

## Packet layout (44 bytes + body)

Every TX/RX chain is one packet: a 44-byte header followed by 0..len
bytes of payload. Fields (little-endian):

```
offset  size  field
  0      8   src_cid
  8      8   dst_cid
 16      4   src_port
 20      4   dst_port
 24      4   len         (payload byte count)
 28      2   type        (1 = stream)
 30      2   op          (see Op table below)
 32      4   flags       (SHUTDOWN uses bits 0 (recv) / 1 (send))
 36      4   buf_alloc   (how many bytes peer may send before draining)
 40      4   fwd_cnt     (how many bytes WE'VE consumed, for credit)
```

Zig note: `extern struct` rounds the struct to 48 bytes because of u64
alignment; the on-wire size is 44. We hand-encode/decode via
`std.mem.readInt/writeInt` rather than memcpy the struct, and skip
the normally-helpful `@sizeOf` sanity assert that would fire here.

### Op table

| Op             | Value | Meaning                                |
| -------------- | ----- | -------------------------------------- |
| invalid        | 0     | padding, should never appear on wire   |
| request        | 1     | "please connect"                       |
| response       | 2     | "accepted"                             |
| rst            | 3     | reset; kill the connection             |
| shutdown       | 4     | graceful close of recv/send half(s)    |
| rw             | 5     | carries payload bytes                  |
| credit_update  | 6     | informational: "I've consumed N bytes" |
| credit_request | 7     | "tell me how much you've consumed"     |

## The UDS bridge

Map one or more Unix sockets on the host to guest ports via
`MACHINEN_VSOCK`. Comma-separated, each entry one of:

```
<port>:<path>        # legacy — same as in:
in:<port>:<path>     # host listens; UDS clients drive a stream into
                     #   guest (cid=3, port)
out:<port>:<path>    # guest initiates; when REQUEST for (cid=2, port)
                     #   lands, host dials the UDS and wires it up
```

Example: `MACHINEN_VSOCK=in:1234:/tmp/svc.sock,out:5678:/tmp/rpc.sock`.

### Inbound (host → guest) flow

1. Something connects to the host UDS (e.g. `nc -U /tmp/foo.sock`).
2. Bridge thread accepts, allocates a host-side source port
   (starts at 1024, bumps per connection), records the connection.
3. Injects `REQUEST` packet into guest RX queue 0, raises the
   vsock IRQ.
4. Guest kernel delivers to whichever listener is `bind()`ed to
   that port. If no listener, guest replies `RST`.
5. On accept, guest sends `RESPONSE`. Connection open.
6. UDS bytes → bridge reads → wraps in `RW` → guest RX.
7. Guest writes → vCPU thread TX notify → unwrap → `write()` to UDS.
8. Either side closes: `SHUTDOWN` or `RST` → bridge closes the UDS.

### Outbound (guest → host) flow

1. Guest userspace does `socket(AF_VSOCK, SOCK_STREAM)` +
   `connect((2, port))`.
2. Kernel sends `REQUEST` on TX queue 1. Bridge matches the dst_port
   against outbound port-map entries.
3. On match, bridge dials the mapped UDS path. On connect success,
   registers a new Connection (state=established immediately) and
   sends `RESPONSE`. On failure, sends `RST`.
4. Bytes flow bidirectionally, same as inbound after step 5.

## Flow control (credit-based, both directions)

virtio-vsock uses a credit scheme: every packet carries `buf_alloc`
(my receive-buffer size) and `fwd_cnt` (bytes I've consumed from the
peer). Each side computes `peer_buf_alloc - (bytes_sent - peer_fwd_cnt)`
to know how many bytes it may still send before the peer's window
closes.

What the bridge does:

- **Tracks per connection**: `bytes_to_peer`, `peer_buf_alloc`,
  `peer_fwd_cnt`, `fwd_cnt` (bytes we've consumed off the UDS),
  `last_credit_fwd_cnt` (last advertised).
- **Respects the peer window** on sends: `drainConnection` caps the
  `read()` from UDS to `peerRoom(c)`. If room is 0, sets `paused=true`
  and drops the fd from the POLLIN set.
- **Unpauses** when an inbound packet advances `peer_fwd_cnt` far
  enough to re-open the window. Nudges the poll loop so the fd is
  re-added immediately.
- **Emits CREDIT_UPDATE** when we've drained (into the UDS) half of
  our advertised buf_alloc worth of new bytes since the last update.
  Also responds to explicit CREDIT_REQUEST.
- **Advertises** `buf_alloc = 256 KiB` on every outgoing packet. The
  guest kernel treats this as a hint and paces accordingly.

## Threading + locking

Two threads touch the Device:

- vCPU thread: handles MMIO exits (status writes, queue config, TX
  doorbell → `handleTxChain`).
- Bridge thread: poll()s the UDS listener + all connection fds,
  handles accepts and reads from UDS, injects RX packets.

Both threads walk virtqueue memory. A `PthreadMutex` (the same
pattern `hvf.Pl011` uses, because `std.Thread.Mutex` moved under
`std.Io` in Zig 0.16) guards the connection table and RX-queue
walks. MMIO config/queue-setup writes are unlocked — they happen
during a narrow window at boot and then sit steady-state; a formal
fix would be to atomic-flag "vsock ready" before the bridge starts
processing. Tolerable for M1.

## Event queue

Queue 2 is also driver-posts-empty-buffers (same pattern as RX). The
spec only uses it for `VIRTIO_VSOCK_EVENT_TRANSPORT_RESET` (payload
is a single u32 of value 0), which the guest respects by tearing down
all its vsock state and starting over. That matters mainly on CRIU
restore, where the pre-dump device state is gone.

We set `skip_notify_queues` bits 0 and 2 so the generic auto-drain
path leaves both alone. The bridge doesn't send events yet — wiring
a `sendTransportReset()` helper is a ~10-line addition once we need
it (CRIU restore is the obvious trigger).

## What's still missing (M3+)

- **Dynamic port map at runtime.** Env var is fine for smoke/
  integration; a control-plane RPC to add/remove mappings without a
  VMM restart is what production wants.
- **Transport-reset trigger on restore.** Primitive's in place; hook
  isn't wired into the CRIU restore path.
- **Multi-guest-CID / hotplug.** Not needed until we're running
  multiple VMs against one VMM process.

## Repro

```
# Inbound round-trip — host UDS → guest AF_VSOCK listener.
./packages/microvm/test-fixtures/smoke.sh vsock
# -> PASS: UDS <-> guest AF_VSOCK round-trip
# -> PASS: vsock bridge reported an inbound port

# Outbound round-trip — guest AF_VSOCK connect(2, ...) → host UDS.
./packages/microvm/test-fixtures/smoke.sh vsock-out
# -> PASS: guest-initiated round-trip (cid=2) returned uppercased bytes
# -> PASS: vsock bridge reported the outbound mapping
```

Interactive poke:

```
./packages/microvm/test-fixtures/try.sh vsock
```

## Refs

- virtio 1.2 spec, §5.10 (Socket Device) — wire format, queue layout.
- Linux kernel: `net/vmw_vsock/virtio_transport.c` (guest driver),
  `net/vmw_vsock/virtio_transport_common.c` (state machine).
