# virtio-vsock — host↔guest stream sockets without a network

Issue: redwoodjs/machinen#44. First cut landed with the bridge device
+ a Unix-socket-to-guest-port bridge. What's here is enough to run
`nc -U /tmp/machinen-vsock.sock` on the host and have bytes round-trip
through an `AF_VSOCK` listener inside the guest.

## Why bother when we have slirp?

slirp gives the guest real TCP/IP through the VMM process's sockets.
That's great for "let the guest reach the outside world." But for
host↔guest *control plane* things — "hey host, I'm idle, checkpoint
me now" or "send this JSON to the agent inside" — you don't want to
route through DHCP/NAT/TCP. You want a point-to-point channel that:

* doesn't fight with guest network config (no `eth0 down` killing it),
* survives IP reconfiguration,
* doesn't need a port mapping the guest can see,
* doesn't hit the TIME_WAIT/ephemeral-port issues a shared NAT has.

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

* queue 0 = RX — **guest posts empty buffers, device fills them**
* queue 1 = TX — **guest posts full buffers for device to read**
* queue 2 = event — rarely used; only kicks on transport reset

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

| Op             | Value | Meaning                                    |
|----------------|-------|--------------------------------------------|
| invalid        | 0     | padding, should never appear on wire       |
| request        | 1     | "please connect"                           |
| response       | 2     | "accepted"                                 |
| rst            | 3     | reset; kill the connection                 |
| shutdown       | 4     | graceful close of recv/send half(s)        |
| rw             | 5     | carries payload bytes                      |
| credit_update  | 6     | informational: "I've consumed N bytes"     |
| credit_request | 7     | "tell me how much you've consumed"         |

## The UDS bridge

We map one or more Unix sockets on the host to guest ports. Set
`MACHINEN_VSOCK=<guest_port>:<host_uds_path>` to enable (M1 supports
one mapping; multi-port is a 10-line change — `PortMap[]` already
exists in the API).

Flow for a host-initiated connection:

1. Something connects to the host UDS (e.g. `nc -U /tmp/foo.sock`).
2. A bridge thread accepts, allocates a host-side source port
   (starts at 1024, bumps per connection), records the connection.
3. Injects a `REQUEST` packet into guest RX queue 0, raises the
   vsock IRQ.
4. Guest kernel delivers it to whichever listener is `bind()`ed to
   that port. If no listener, guest sends `RST` back.
5. On accept, guest sends `RESPONSE`. The connection is now open.
6. UDS bytes → bridge reads → wraps in `RW` packet → guest RX.
7. Guest writes → bridge reads TX queue on vCPU thread → unwraps →
   write to UDS fd.
8. Either side closes: `SHUTDOWN` or `RST`, bridge closes the UDS.

## Flow control (we punt for now)

virtio-vsock has a credit scheme: every packet carries `buf_alloc`
(my receive buffer size) and `fwd_cnt` (bytes I've consumed). The
peer tracks `buf_alloc - (bytes_sent - fwd_cnt)` and stops sending
when it hits zero, resuming on a `credit_update`.

For M1 we advertise a fixed large `buf_alloc` (256 KiB) and send a
`credit_update` after every RW we forward to the UDS. The guest's
in-tree transport plays nice with this — no stalls in testing.
Tight flow-control matters when a slow UDS peer can't keep up with
guest writes; we'll tackle it when it bites.

## Threading + locking

Two threads touch the Device:

* vCPU thread: handles MMIO exits (status writes, queue config, TX
  doorbell → `handleTxChain`).
* Bridge thread: poll()s the UDS listener + all connection fds,
  handles accepts and reads from UDS, injects RX packets.

Both threads walk virtqueue memory. A `PthreadMutex` (the same
pattern `hvf.Pl011` uses, because `std.Thread.Mutex` moved under
`std.Io` in Zig 0.16) guards the connection table and RX-queue
walks. MMIO config/queue-setup writes are unlocked — they happen
during a narrow window at boot and then sit steady-state; a formal
fix would be to atomic-flag "vsock ready" before the bridge starts
processing. Tolerable for M1.

## What's still missing (M2+)

* **Guest-initiated connections.** Right now only host→guest is
  wired. The protocol supports it symmetrically; we'd need a UDS
  *listener* in the bridge for each guest port we want to expose
  *from* the host side.
* **Proper flow control.** See above.
* **Dynamic port map at runtime.** M1 parses one `MACHINEN_VSOCK`
  env var; production wants a control plane API.
* **Event queue handling.** Currently we ack-and-drop. The spec
  uses it only for `VIRTIO_VSOCK_EVENT_TRANSPORT_RESET` which
  matters mainly for migration / CRIU restore.
* **Multi-guest-CID / hotplug.** Not needed until we're running
  multiple VMs against one VMM process.

## Repro

```
# Terminal: run the smoke test.
./packages/microvm/test-fixtures/smoke.sh vsock
# -> PASS: UDS <-> guest AF_VSOCK round-trip
# -> PASS: vsock bridge came up on host
```

Or for a manual poke:

```
./packages/microvm/test-fixtures/try.sh vsock
```

The guest side runs a Python echo server (`AF_VSOCK` port 1234); the
host side uses Python to round-trip "hello-vsock" through the UDS.

## Refs

* virtio 1.2 spec, §5.10 (Socket Device) — wire format, queue layout.
* Linux kernel: `net/vmw_vsock/virtio_transport.c` (guest driver),
  `net/vmw_vsock/virtio_transport_common.c` (state machine).
