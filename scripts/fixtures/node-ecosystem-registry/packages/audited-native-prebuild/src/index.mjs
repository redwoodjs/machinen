import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function nativeValue() {
  return require("../selected/addon.node").value();
}
