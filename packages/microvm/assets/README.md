# Production microVM assets

Files in this directory are production guest/base-image inputs. They are either
compiled into `release-assets/`, copied into the guest rootfs, or used to build
the production kernel/device-tree assets.

Do not put proof-only workloads, native continuation fixtures, runtime harnesses,
or checked-summary fixtures here. Those belong outside this repository.
