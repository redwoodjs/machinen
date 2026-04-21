# Rootfs contract — how bundles, builds, and snapshots fit together

## Problem

Someone wants to run their tool — an AI agent, a script, a service — in
a sandbox, share it with a teammate, and resume it on another machine.
Today they'd reach for Docker: write a Dockerfile, build an image, push
to a registry, pull from the other side.

We don't want to rebuild Docker. Docker is a big stack — registry
protocol, layer formats, image config, credential helpers — and most
of that complexity doesn't pay off for a single-sandbox workflow.

The thing we actually need:

1. A **tiny base** the user starts from.
2. A way for them to **install what they want** into it.
3. A way to **freeze and share** the result.

That's it. No images, no registries, no Dockerfile.

## Solution

Three layers, each small and independent:

- **Base rootfs.** Alpine + apk + `/init` + vsock agents. ~8MB. One,
  not many. No Node, no Python, no agent-specific tools. We ship it.
- **Build API.** A TypeScript function (`build(...)`) that boots the
  base, runs the user's install steps inside it, then freezes the
  guest state to disk. The user writes a `build.ts` that imports this.
- **Snapshot.** The output of `build(...)`. One file (or small
  directory) containing the frozen guest: its memory, disk, and a bit
  of metadata. Shareable by any means (scp, S3, GitHub Releases).
  Consumed by `spawn({ snapshot })`.

`docker build` becomes `tsx build.ts`. `docker push` becomes `scp`.
`docker pull` becomes `curl`. `docker run` becomes `machinen run
--snapshot`.

The user never touches OCI. We never implement a registry.

## How the pieces fit

```
           build.ts                    snapshot file
              │                              │
              ▼                              ▼
┌────────────────────────────┐  ┌────────────────────────────┐
│  @machinen/runtime.build   │  │  @machinen/runtime.spawn   │
│  ──────────────────────    │  │  ──────────────────────    │
│  1. boot base rootfs       │  │  1. restore snapshot       │
│  2. run user install hook  │  │  2. workload resumes       │
│  3. freeze guest           │  │                            │
│  4. write snapshot file    │  │                            │
└────────────────────────────┘  └────────────────────────────┘
           │                              ▲
           └──── snapshot file ───────────┘
```

Inside the VMM, both paths boot the same kernel against the same
bundle format (below). The bundle is an internal detail; most users
never see it. `build` materializes a bundle from the base rootfs and
the user's install steps; `spawn` materializes a bundle from a
snapshot.

## The bundle layout (internal format)

A bundle is a directory the runtime hands to the VMM:

```
<bundle>/
├── rootfs/                 # the guest's filesystem tree
└── machinen-config.json    # tells /init what to run
```

- **`rootfs/`** — literal guest filesystem. Linux semantics: owners,
  permissions, symlinks, xattrs.
- **`machinen-config.json`** — small JSON file next to `rootfs/` so
  `/init` knows what to exec, which agents to start, etc.

Everything else in `<bundle>/` is ignored. The runtime writes bundles;
users don't hand-author them.

## machinen-config.json

Minimal schema. All fields optional except `cmd`.

```jsonc
{
  "arch": "arm64",
  "cmd": ["/bin/sh"],
  "env": { "PATH": "/usr/local/bin:/usr/bin:/bin" },
  "cwd": "/root",
  "user": "root",
  "agents": { "winsize": true, "secrets": true, "files": true }
}
```

Field rules:

- **`cmd`** — argv of the workload. No shell interpretation.
- **`env`** — flat string map. `/init` passes verbatim plus its own
  `TERM=linux` unless overridden.
- **`cwd`** — chdir before exec. Falls back to `/` on error.
- **`user`** — name (resolved against `/etc/passwd`) or numeric uid.
- **`agents`** — which machinen vsock agents to start. `{}` disables
  them all. Agents ship with the base rootfs.
- **`arch`** — `"arm64"` or `"amd64"`. Runtime rejects mismatches.

Unknown fields are ignored; we'll add `"version": 1` when the first
breaking change lands.

## The init layer

`/init` is machinen's. It ships with the base rootfs and runs on every
boot. Users don't override it. In order, it:

1. Mounts `/proc`, `/sys`, `/dev`.
2. Opens `/dev/console`, dups fds 0/1/2.
3. Reads `/machinen-config.json`.
4. Starts the agents named in `agents`.
5. `chdir(cwd)`, drops to `user`, `exec(cmd)` with `env`.

Signal forwarding and zombie reaping live inside `/init` as a tiny
supervisor around the `exec`'d child.

The existing `init.c` grows up: today it hardcodes `/demo.sh`;
contract version reads config and execs whatever it names.

## The build API

```ts
import { build } from "@machinen/runtime";

await build({
  // Optional: which base to start from. Defaults to the bundled
  // Alpine base.
  base: "alpine",

  // Runs inside the booted VM. `vm` has exec/read/write helpers.
  install: async (vm) => {
    await vm.exec("apk add nodejs npm git");
    await vm.exec("npm i -g @anthropic-ai/claude-code");
  },

  // Optional: what runs by default when this snapshot is spawned.
  // Translates to machinen-config.json `cmd`.
  cmd: ["/bin/sh"],

  // Where to write the snapshot.
  out: "./claude-sandbox.machinen",
});
```

Under the hood:

1. Materialize a base bundle (unpack the shipped base tarball + a
   fresh `machinen-config.json` with `cmd: ["/bin/sh"]` so the build
   VM has a shell to exec).
2. Spawn the VMM. Wait for the shell to come up over vsock.
3. Pipe `install` commands through a control-plane vsock agent.
4. When `install` returns, tell the guest to quiesce; CRIU-freeze it.
5. Bundle CRIU images + filesystem state + final `machinen-config.json`
   (with the user's `cmd`) into one snapshot file.

The user's code runs on the host; it calls into the guest via `vm.exec`.
Think of it as `node-pty` for the microVM.

## The snapshot format

A snapshot is either:

- **A directory** with the bundle + CRIU image dir next to it, or
- **A single tarball** (same layout, compressed) for easy transfer.

We support both. `spawn({ snapshot })` accepts either. The file
extension `.machinen` is a tarball by convention.

No manifest, no registry, no signing spec yet. When we need integrity,
a detached sha256 + optional cosign signature is enough.

## What this explicitly is not

- **Not OCI.** No registry protocol, no layer tarballs, no image
  config translation. If that changes, `@machinen/oci` can exist
  later as an optional package that produces snapshots; the base
  product doesn't need it.
- **Not a container runtime.** We don't implement namespaces, cgroups,
  seccomp. The guest *is* the isolation boundary.
- **Not a plugin lifecycle API.** No `register()`, no hooks. People
  extending machinen either import the build API, produce a snapshot
  file, or ship an alternate base rootfs tarball.

## Open questions

- **Reproducibility of builds.** Same `build.ts` twice → same
  snapshot? Needs pinned apk/npm versions (lockfiles on the host,
  fed into the build) and a deterministic freeze point. Solvable;
  probably not v0.
- **Build-time secrets.** Credentials needed *during* install
  (private registries, GitHub tokens) must not land in the frozen
  snapshot. Explicit scoped env + a "strip before freeze" hook.
- **Incremental freeze / layer cache.** Docker caches layers; we
  don't. v0 = always rebuild. If iteration gets painful, add
  intermediate freeze points keyed on `install` step hashes.
- **Distribution integrity.** Snapshot files floating around the
  internet need a hash + optional signature story. Small addition,
  not blocking v0.
- **Writable layer per spawn.** Two spawns from one snapshot
  shouldn't clobber each other. CoW clone of the disk on spawn.
  Tied to #50 M3.
