import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "bin");

// Zig-native host-side FUSE-over-vsock mount server (#329). Opt-in via
// MACHINEN_MOUNT_SERVER_IMPL=zig — without that env, the runtime
// continues to spawn the JS implementation from
// @machinen/runtime/dist/mount-server-bin.js. CI stages the binary
// into bin/ during publish; absent in the repo so `git status` stays
// clean.
export const binary = join(binDir, "machinen-mount-server");
