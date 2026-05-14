import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "bin");

// Zig-native host-side FUSE-over-vsock mount server (#329) for
// linux-arm64 hosts. CI cross-compiles from darwin via
// `zig build -Dtarget=aarch64-linux-gnu` and stages into bin/ during
// publish; absent in the repo so `git status` stays clean.
export const binary = join(binDir, "machinen-mount-server");
