import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bundled mke2fs has its dylibs at @loader_path/../lib/* — the bin/
// and lib/ siblings here have to stay together or dyld will fail.
const binDir = join(dirname(fileURLToPath(import.meta.url)), "bin");

export const mke2fs = join(binDir, "mke2fs");
