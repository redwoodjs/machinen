# Container images and the VMM — what boots what

**The VMM does not load container images.** cloud-hypervisor,
libkrun, Firecracker, even our own Zig VMM — none of them know
what an OCI image is. They boot kernels against a rootfs that
something _else_ prepared.

## The mental model

Think of it as two separate jobs:

```
┌─────────────────────────────┐
│ OCI pipeline (pull, unpack) │   machinen's job
│ manifest → layers → rootfs  │
└──────────────┬──────────────┘
               │ rootfs dir or disk image
               ▼
┌─────────────────────────────┐
│ VMM (cloud-hypervisor)      │   substrate's job
│ boot kernel against rootfs  │
└─────────────────────────────┘
```

The VMM takes three inputs: a kernel, a rootfs (directory or
disk image), and a command line. It doesn't care whether that
rootfs came from `debootstrap`, from a tarball, from a Docker
image, or was hand-crafted. It's just bytes on a block device
or a directory to be mounted.

## What "OCI pull" actually means

An OCI (Open Container Initiative) image is, concretely:

- **A manifest** (JSON) — lists the config and the ordered
  layers.
- **A config** (JSON) — env vars, entrypoint, cmd, working dir,
  architecture.
- **Layers** (tarballs, usually gzipped) — each layer is a
  filesystem diff on top of the one below. Deleted files are
  represented by `.wh.<name>` "whiteout" marker files.

To turn this into a rootfs you:

1. **Fetch the manifest** from the registry (`registry-1.docker.io`,
   `ghcr.io`, etc.) over HTTPS. Registry protocol v2.
2. **Fetch each layer** by digest. Verify sha256. Decompress.
3. **Unpack layers in order** into a directory, processing
   whiteouts. Lower layers first, upper layers overwrite.
4. **Read the config** to know what command to run and what env
   vars to set at launch.

The result is a directory tree. That tree is what the VMM sees
as `/`.

## Who does the OCI pipeline in each ecosystem

| Tool                 | Has OCI pipeline? | How                                   |
| -------------------- | ----------------- | ------------------------------------- |
| **cloud-hypervisor** | No                | You hand it a prepared rootfs         |
| **libkrun** (raw)    | No                | You hand it a prepared rootfs         |
| **krunvm**           | Yes               | Wraps libkrun, uses `buildah` to pull |
| **Firecracker**      | No                | AWS handles it above in Fargate       |
| **Docker Desktop**   | Yes               | Whole product, not just a VMM         |
| **podman**           | Yes               | Same space as Docker                  |
| **containerd**       | Yes               | The pull/unpack is its primary job    |
| **machinen**         | (up to us)        | See below                             |

Notice the pattern: if a tool lets you `docker run alpine` or
similar, it has an OCI pipeline bolted on. The VMMs that _don't_
expose that verb don't have one.

## What this means for machinen

Machinen's substrate-v1 plan (step 2 in
`projects/machinen/substrate-v1-plan.md`) punts generic OCI
pull. Instead, capabilities are a **pre-baked layer format
machinen controls** — `--with gh`, `--with node`, `--with git`
compose from layers we built and signed, not arbitrary
registry images.

This is deliberate:

- **Security.** No running `docker pull whatever` with untrusted
  layer contents during sandbox setup. The supply chain is ours.
- **Reproducibility.** A preset like `claude-dev` always
  composes the same exact layers. No "`latest` tag moved."
- **Size.** Pre-baked layers are lean; no wasted apt metadata,
  no build-tool bloat. Same reason smol-machines gets sub-1s
  boot — every byte of the rootfs is intentional.
- **Performance.** Pre-baked means cached. No pull-on-first-use
  latency.

Generic OCI pull remains on the roadmap (somewhere around
"community capabilities you can `--with foo/bar`") but it's not
a v1 concern. If we ever need it, the library options in TS
land are:

- Shell out to `skopeo copy` + `umoci unpack` — two mature
  binaries, compose into a rootfs dir.
- Shell out to `crane pull` — Go, single binary.
- `@astronautlabs/oci` or `oci-distribution`-style npm client —
  native TS, more code but no binary dependency.

## For v1, the rootfs flow looks like

1. machinen composes the rootfs from pre-baked capability
   layers (overlay-style or assembled via `rsync`).
2. Layer contents live as directory trees under
   `~/.machinen/capabilities/<name>/` on the host.
3. The composed rootfs is presented to cloud-hypervisor either
   as:
   - **virtio-fs shared directory** (no copy; host `/.../rootfs`
     is the guest `/`), or
   - **a disk image** built on demand (`mkfs.ext4` a file, copy
     into it, pass `--disk path=…`).
4. The Debian cloud kernel boots against this rootfs, runs the
   in-guest daemon (step 3 of the plan), which accepts RPC
   over vsock.

No OCI anywhere in that pipeline. Not today. Maybe later, as a
specific feature for a specific use case.
