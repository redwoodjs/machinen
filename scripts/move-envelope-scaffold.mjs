#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  allowPositionals: true,
  options: {
    name: { type: "string" },
    family: { type: "string", default: "deterministic-one-shot" },
    state: { type: "string" },
    proof: { type: "string" },
    refusal: { type: "string" },
    "out-dir": { type: "string", default: "/tmp/machinen-envelope-scaffold" },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const name = values.name;
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(
    "usage: move-envelope-scaffold --name <kebab-name> [--family family] [--state stateName] [--proof proof-name] [--refusal refusal-proof]",
  );
  process.exit(2);
}

const camel = toCamel(name);
const pascal = toPascal(name);
const state = values.state ?? `${camel}State`;
const proof = values.proof ?? name;
const refusal = values.refusal ?? `unsafe-${name}-refusal`;
const outDir = values["out-dir"];

const files = [
  {
    path: `packages/cli/src/move-${name}-envelope.ts`,
    content: `import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";\n\n// Scaffold family: ${values.family}\n// State field: ${state}\n// TODO: replace placeholders with the narrow accepted argv and preflight contract.\n\nexport async function readMove${pascal}StateInVm(\n  _vm: VmHandle,\n  _node: MovePidGraphNode,\n): Promise<unknown | undefined> {\n  return undefined;\n}\n\nexport async function runMoveTarget${pascal}LoaderInVm(\n  _vm: VmHandle,\n  _descriptor: MoveDescriptor,\n): Promise<unknown> {\n  throw new Error("move ${name} scaffold loader is not implemented");\n}\n`,
  },
  {
    path: `packages/cli/src/__tests__/move-${name}-envelope.test.ts`,
    content: `import { describe, expect, it } from "vitest";\n\ndescribe("move ${name} envelope scaffold", () => {\n  it("records the accepted proof and refusal proof names", () => {\n    expect(${JSON.stringify(proof)}).toBeTruthy();\n    expect(${JSON.stringify(refusal)}).toBeTruthy();\n  });\n});\n`,
  },
  {
    path: `scripts/smoke/move-${name}-matrix-fragment.sh`,
    content: `# Scaffold matrix rows for ${name}.\n# Add these names to the matrix plan after implementing the envelope.\n# support proof: ${proof}\n# refusal proof: ${refusal}\n`,
  },
  {
    path: `docs/snapshot/move-envelope-${name}-checklist.md`,
    content: `# ${pascal} move envelope checklist\n\nFamily: ${values.family}\n\n## Support proof\n\n- [ ] Descriptor state field: \`${state}\`.\n- [ ] Loader strategy runs a target-native binary.\n- [ ] Support matrix row \`${proof}\` records visible target evidence.\n\n## Refusal proof\n\n- [ ] Unsupported argv/config shape refuses before target launch.\n- [ ] Changed identity refuses before target launch.\n- [ ] Symlink or unsafe path race refuses before target launch when applicable.\n- [ ] Missing target binary refuses with no target pid when applicable.\n- [ ] Refusal matrix row \`${refusal}\` records no target pid or no loader launch.\n`,
  },
];

if (!values["dry-run"]) {
  for (const file of files) {
    const fullPath = join(outDir, file.path);
    mkdirSync(fullPath.slice(0, fullPath.lastIndexOf("/")), { recursive: true });
    writeFileSync(fullPath, file.content);
  }
}

const summary = {
  name,
  family: values.family,
  state,
  proof,
  refusal,
  outDir,
  dryRun: values["dry-run"],
  files: files.map((file) => file.path),
};

if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Envelope scaffold ${values["dry-run"] ? "planned" : "written"}: ${name}`);
  for (const file of summary.files) {
    console.log(`- ${file}`);
  }
}

function toCamel(value) {
  return value.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function toPascal(value) {
  const camelValue = toCamel(value);
  return camelValue[0].toUpperCase() + camelValue.slice(1);
}
