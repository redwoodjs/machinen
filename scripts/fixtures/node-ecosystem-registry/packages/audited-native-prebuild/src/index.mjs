import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const selectedAddonPath = fileURLToPath(new URL("../selected/addon.node", import.meta.url));

export function nativeValue() {
  return require(selectedAddonPath).value();
}
