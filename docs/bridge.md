# Bridge — guest↔host RPC

The bridge is a generic RPC channel between a guest workload and the
host process that booted it. Built on
[Cap'n Web](https://github.com/cloudflare/capnweb), so the host-side
API is just a JS class — no invented vocabulary, no method registry,
no `expose`/`unexpose`.

- **Wire**: AF_VSOCK CID 2 port **1979** (constant `BRIDGE_VSOCK_PORT`).
- **Protocol**: Cap'n Web — JSON message frames, newline-delimited
  on the UDS that backs the vsock port.
- **Direction**: guest → host call/response. Host responds; guest
  awaits. (Promise pipelining works when both ends speak Cap'n Web.)

## Host: define a target

The bridge surface is whatever methods you put on a class extending
`RpcTarget`. The class can hold a reference to the `VmHandle` so its
methods can drive the VM (fork, exec, mount, etc.).

```ts
import { boot, RpcTarget, type VmHandle } from "@machinen/runtime"

class Api extends RpcTarget {
  constructor(private vm: VmHandle) {
    super()
  }

  async fork(params: { name?: string }) {
    const f = await this.vm.fork({ name: params.name })
    await f.detach()
    return { name: f.name, pid: f.pid }
  }

  async log(line: string) {
    process.stdout.write(`[guest] ${line}\n`)
  }
}

const vm = await boot({
  image: "rootfs.tar.gz",
  cmd: ["/bin/sh"],
  bridge: (vm) => new Api(vm), // factory — receives the handle
})
```

The `bridge` option is a factory `(vm: VmHandle) => RpcTarget`. It's
called once after the `VmHandle` is constructed so the target can
capture `vm`. There's no chicken-and-egg: the handle exists before
the factory runs.

### Live swap

`vm.bridge` is a writable property. Reassigning it takes effect for
**connections opened after the assignment**; in-flight sessions keep
their original target. Good for swapping APIs between phases of a
workload's lifecycle.

```ts
vm.bridge = new OtherApi(vm)
```

Set to `undefined` to drop the surface entirely — the listener stays
up but every method call resolves to a Cap'n Web error.

### Attach handles

`vm.bridge` is meaningful only on the boot-owning handle. Reads on an
attach handle return `undefined`; writes throw `REGISTRY_VM_NOT_FOUND`
because the listener runs in the booting process and another process
can't reach into it. Move the assignment into the booting process.

## Guest: dial port 1979

There's no shipped Node client yet (planned). For now, anything that
can speak Cap'n Web's wire over a vsock connection works. The minimum
is:

1. `socket(AF_VSOCK)` → `connect(CID_HOST=2, port=1979)`.
2. Speak Cap'n Web (JSON message frames, newline-delimited).
3. Issue method calls; await responses.

A guest CLI (`machinen-bridge`) is on the roadmap so shell scripts
and non-JS guest workloads can do `machinen-bridge call fork --params
'{"name":"x"}'` without an in-language Cap'n Web client.

## Wire framing

Cap'n Web's `RpcTransport` is message-oriented (each `send`/`receive`
is one logical message — a JSON array). The runtime's UDS transport
frames messages with a trailing `\n`; Cap'n Web's own messages never
contain raw newlines, so the framing is unambiguous.

A frame larger than 64 KiB drops the connection — same cap as the
exec/file agents, so a buggy or hostile guest can't OOM the host by
spamming an unterminated line.

## Lifecycle

The bridge UDS is auto-allocated when `boot()` synthesizes the
`MACHINEN_VSOCK` spec. The runtime appends `out:1979:<bridge.sock>`
alongside the exec UDS so the VMM forwards CID 2 port 1979
connections from the guest to the host UDS. Callers who pre-set
`MACHINEN_VSOCK` are opted out — they're driving and can append the
bridge entry themselves if they want it.

The listener is bound **before** the VMM spawns so a guest dialing
port 1979 immediately after boot can't race the UDS. It tears down
on VMM exit (clean shutdown, kill, snapshot, fork) along with the
rest of the per-boot scratch state.
