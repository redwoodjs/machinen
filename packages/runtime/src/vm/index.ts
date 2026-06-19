// @machinen/runtime — TypeScript surface for booting microVMs.
//
// This file is a thin barrel re-exporting the boot/attach/restore/fork
// surfaces. The implementations live next to it:
//
//   vm-boot.ts          boot() + BootOptions, the host-side VMM
//                       lifecycle (asset resolve, gvproxy, initramfs
//                       pack, rootdisk materialize, spawn, registry,
//                       VmHandle, --detached gate)
//   vm-attach.ts        attach() + AttachOptions
//   vm-restore.ts       restore() + RestoreOptions
//   vm-snapshot.ts      performSnapshot, SnapshotContext
//   vm-fork.ts          performFork, measureFirstByte
//   vm-bundle.ts        liveMount resolution, buildMachinenConfig,
//                       resolveRestoreLiveMounts, synthesizeAndPackBundle
//   vm-image-config.ts  ImageConfig, warmImageConfigCache, readImageConfig
//   vm-helpers.ts       pure utilities (memory sizing, vmm binary,
//                       mount/path validators, shell quoting,
//                       writeFile cmd builders, console ring buffer,
//                       hostname helpers)
//
// Production usage:
//   const vm = await boot({ image: "./rootfs.tar.gz", cmd: ["/bin/sh"] });
//   await vm.exec("uname -a");
//   await vm.wait();
//
// CRIU snapshot/restore (#50 M2):
//   const vm = await boot({ image, cmd });
//   await vm.exec("prep stuff");
//   await vm.snapshot("./warm.snap");
//   const restored = await boot({ snapshot: "./warm.snap" });

export { attach, type AttachOptions } from "./attach.ts";
export { boot, type BootOptions } from "./boot.ts";
export type { BootCpuResourceOptions, ResolvedCpuResourcePolicy } from "./cpu-resources.ts";
export type { BootMemoryResourceOptions, BootResourcesOptions } from "./memory-resources.ts";
export { buildMachinenConfig, resolveRestoreLiveMounts } from "./bundle.ts";
export type { LiveMountCacheMode, LiveMountSyncMode } from "./bundle.ts";
export { measureFirstByte } from "./fork.ts";
export {
  autoSizeMemoryMib,
  buildWriteFileCmd,
  buildWriteFileCmds,
  resolveVmmBinary,
} from "./helpers.ts";
export { type ImageConfig, readImageConfig, warmImageConfigCache } from "./image-config.ts";
export { restore, type RestoreOptions } from "./restore.ts";

import {
  collect as _collect,
  CONSOLE_TAIL_BYTES as _CONSOLE_TAIL_BYTES,
  validateMemoryMib as _validateMemoryMib,
} from "./helpers.ts";
import { resolveCpuResourcePolicy as _resolveCpuResourcePolicy } from "./cpu-resources.ts";
import { resolveMemoryCeilingMib as _resolveMemoryCeilingMib } from "./memory-resources.ts";

// Visible to tests that exercise the ring-buffer logic without booting a VM.
export const _internal = {
  collect: _collect,
  CONSOLE_TAIL_BYTES: _CONSOLE_TAIL_BYTES,
  validateMemoryMib: _validateMemoryMib,
  resolveMemoryCeilingMib: _resolveMemoryCeilingMib,
  resolveCpuResourcePolicy: _resolveCpuResourcePolicy,
};
