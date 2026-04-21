import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const binary = join(dirname(fileURLToPath(import.meta.url)), "bin", "microvm");
