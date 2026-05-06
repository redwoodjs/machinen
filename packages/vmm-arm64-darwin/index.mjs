import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = join(dirname(fileURLToPath(import.meta.url)), "bin");

export const binary = join(binDir, "machinen-vm");
// gvproxy (containers/gvisor-tap-vsock) — optional sibling binary the
// runtime auto-spawns for virtio-net. Present when CI stages it during
// publish; absent in the repo so `git status` stays clean.
export const gvproxy = join(binDir, "gvproxy");
// machinen-page-server — host-side CRIU page-server (#266 step 2).
// Only spawned when restore() / vm.fork() is called with
// `lazyPages: true`; absent in the repo so `git status` stays clean.
export const pageServer = join(binDir, "machinen-page-server");
