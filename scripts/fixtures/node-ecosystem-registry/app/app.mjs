import { createRequire } from "node:module";
import { value as transitive } from "audited-transitive-a";
import { value as peer } from "audited-peer-consumer";
import { optionalValues } from "audited-optional-consumer";
import { value as conditionalImport } from "audited-conditional-exports";
import { value as dualEsm } from "audited-dual-package";
import { nativeValue } from "audited-native-prebuild";
const require = createRequire(import.meta.url);
const conditionalRequire = require("audited-conditional-exports").value;
const dualCjs = require("audited-dual-package").value;
const optional = await optionalValues();
console.log(
  JSON.stringify({
    ok: true,
    transitive,
    peer,
    optional,
    conditionalImport,
    conditionalRequire,
    dualEsm,
    dualCjs,
    native: nativeValue(),
  }),
);
