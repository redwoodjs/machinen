import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "bin");
const guestDir = join(here, "guest");

export const binary = join(binDir, "machinen-vm");
// gvproxy (containers/gvisor-tap-vsock) — optional sibling binary the
// runtime auto-spawns for virtio-net. Present when CI stages it during
// publish; absent in the repo so `git status` stays clean.
export const gvproxy = join(binDir, "gvproxy");

// Guest binaries (arm64-linux ELFs) the runtime reads to build the
// initramfs cpio at boot(). Read as data, never exec()d on the host,
// so the +x bit doesn't matter. CI stages them into guest/ during
// publish; absent in the repo so `git status` stays clean.
export const initPath = join(guestDir, "init");
export const fuseAgentPath = join(guestDir, "fuse-agent");
export const execAgentPath = join(guestDir, "exec-agent");
