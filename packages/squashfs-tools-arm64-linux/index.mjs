import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = join(dirname(fileURLToPath(import.meta.url)), "bin");

export const mksquashfs = join(binDir, "mksquashfs");
