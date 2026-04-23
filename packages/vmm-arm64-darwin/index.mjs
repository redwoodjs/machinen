import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = join(dirname(fileURLToPath(import.meta.url)), "bin");

export const binary = join(binDir, "microvm");
// gvproxy (containers/gvisor-tap-vsock) — optional sibling binary the
// runtime auto-spawns for virtio-net. Present when CI stages it during
// publish; absent in the repo so `git status` stays clean.
export const gvproxy = join(binDir, "gvproxy");
