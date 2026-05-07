import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bundled mksquashfs has its dylibs at @loader_path/../lib/* — the
// bin/ and lib/ siblings here have to stay together or dyld will
// fail. Same packaging trick @machinen/e2fsprogs-arm64-darwin uses.
const binDir = join(dirname(fileURLToPath(import.meta.url)), "bin");

export const mksquashfs = join(binDir, "mksquashfs");
