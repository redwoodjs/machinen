// @machinen/runtime — public API façade.
//
// The runtime core (`boot`, `attach`, `restore`, `measureFirstByte`,
// the host-side VMM orchestration) lives in `./vm.ts`. This file is
// only re-exports — adding a new public symbol means adding it to
// `vm.ts` (or a sibling module) and lifting it here. See issue #190.

export { Sandboxes, Supervisor } from "./multiplex.ts";
export type { SandboxEntry, OnOutputListener, SupervisorOptions } from "./multiplex.ts";
export { bootPty } from "./pty.ts";
export type { PtyBootOptions, PtyVmHandle } from "./pty.ts";
export { VsockWinsize } from "./winsize.ts";
export type { VsockWinsizeOptions } from "./winsize.ts";
export { VsockSecrets } from "./secrets.ts";
export type { VsockSecretsOptions } from "./secrets.ts";
export { VsockFiles } from "./files.ts";
export type { VsockFilesOptions } from "./files.ts";
export { VsockExec } from "./exec.ts";
export type {
  VsockExecOptions,
  VsockExecPtyHandle,
  VsockExecPtyOptions,
  VsockExecPtyResult,
  VsockExecResult,
} from "./exec.ts";
export type { ChunkLogEvent, LogEvent, OnLog, PhaseLogEvent } from "./log.ts";
export { provision, resolveBaseRootfs } from "./provision.ts";
export type { ProvisionOptions, ProvisionResult } from "./provision.ts";
export {
  ensureRootfsImage,
  markRootfsImageClean,
  resolveMke2fs,
  rootfsImgCacheDir,
} from "./rootfs-img.ts";
export type { EnsureRootfsImageOptions } from "./rootfs-img.ts";
export { bootSnapshotPath, detachedLogRoot, writeBootSnapshot } from "./detached-log.ts";
export { validatePid } from "./pid-validate.ts";
export type { PidStatus } from "./pid-validate.ts";
export { runGc } from "./gc.ts";
export type { GcResult, RunGcOptions } from "./gc.ts";
export { list, registryRoot } from "./registry.ts";
export type { RegistryEntry } from "./registry.ts";
export {
  packBundle as mkinitramfsBundle,
  packTinyBundle as mkinitramfsTinyBundle,
  packRootfs as mkinitramfsRootfs,
  packWorkspace as mkinitramfsWorkspace,
  packMinimal as mkinitramfsMinimal,
  cli as mkinitramfsCli,
} from "./mkinitramfs.ts";
export type {
  PackBundleOptions,
  PackTinyBundleOptions,
  PackRootfsOptions,
  PackMinimalOptions,
  PackWorkspaceOptions,
} from "./mkinitramfs.ts";
export {
  MachinenError,
  BootError,
  ExecError,
  SnapshotError,
  ProvisionError,
  RegistryError,
  FilesError,
  MountError,
  SecretsError,
  WinsizeError,
  SandboxError,
  CacheError,
  GvproxyError,
  MkinitramfsError,
  ParseError,
  ErrorCode,
  isMachinenError,
  formatMachinenError,
} from "./errors.ts";
export type { MachinenErrorOptions } from "./errors.ts";
export type {
  ForkOptions,
  SnapshotMeta,
  SnapshotOptions,
  SnapshotResult,
  VmHandle,
  WriteFileOptions,
} from "./vm-handle.ts";
export {
  _internal,
  attach,
  autoSizeMemoryMib,
  boot,
  buildMachinenConfig,
  buildWriteFileCmd,
  buildWriteFileCmds,
  measureFirstByte,
  resolveVmmBinary,
  restore,
} from "./vm.ts";
export { warmImageConfigCache } from "./vm.ts";
export type { AttachOptions, BootOptions, ImageConfig, RestoreOptions } from "./vm.ts";
