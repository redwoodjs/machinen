#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "052-memory-real-url-searchparams",
  rowDir: "portability/nodejs/052-memory-real-url-searchparams",
  kind: "machinen.nodejs-portability-memory-real-url-searchparams-smoke-report",
  shape: "url-searchparams",
  anchors: {
    anchor: "machinen-real-url-searchparams-anchor-v1",
    href: "url-href:https://example.test:8443/portable/path?alpha=1&beta=two&beta=three&gamma=machinen#frag",
    search: "url-search:?alpha=1&beta=two&beta=three&gamma=machinen",
    params: "url-params:alpha=1,beta=two,beta=three,gamma=machinen",
  },
  semanticState: {
    kind: "url-searchparams",
    anchor: "machinen-real-url-searchparams-anchor-v1",
    href: "https://example.test:8443/portable/path?alpha=1&beta=two&beta=three&gamma=machinen#frag",
    origin: "https://example.test:8443",
    pathname: "/portable/path",
    search: "?alpha=1&beta=two&beta=three&gamma=machinen",
    params: [
      ["alpha", "1"],
      ["beta", "two"],
      ["beta", "three"],
      ["gamma", "machinen"],
    ],
  },
  refused: false,
  refusalCode: null,
  refusalReason: null,
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
