import { readFileSync, writeFileSync } from "node:fs";

const API_PATH = process.argv[2] ?? "packages/runtime/API.md";

const TOC = JSON.parse(readFileSync(new URL("./api-toc-symbols.data", import.meta.url), "utf8"));

// GitHub-flavored anchor for a markdown header: lowercase, strip
// non-word chars (keep underscores).
function anchor(symbol) {
  return symbol.toLowerCase().replaceAll(/[^a-z0-9_]/g, "");
}

// Strip typedoc-plugin-markdown decorations to get the canonical
// symbol name: function H3s end with `()`, and the markdown writer
// escapes underscores as `\_` so they don't render as italic.
function normalizeHeader(text) {
  return text.replaceAll("\\", "").replace(/\(\)$/, "");
}

const md = readFileSync(API_PATH, "utf8");

const h3s = new Set();
for (const line of md.split("\n")) {
  const m = /^### (.+)$/.exec(line);
  if (m) {
    h3s.add(normalizeHeader(m[1].trim()));
  }
}

// Two-way validation: TOC entries must be real headers, and every
// real header must be in some TOC bucket (or be reported so we can
// add it).
const tocSymbols = new Set(Object.values(TOC).flat());
const tocMissingHeader = [...tocSymbols].filter((s) => !h3s.has(s));
const headerMissingToc = [...h3s].filter((s) => !tocSymbols.has(s));

if (tocMissingHeader.length > 0) {
  console.error(
    `build-api-toc: TOC references symbols that don't appear as H3 in ${API_PATH}:\n  ${tocMissingHeader.join(
      "\n  ",
    )}`,
  );
  process.exit(1);
}
if (headerMissingToc.length > 0) {
  console.error(
    `build-api-toc: H3 symbols in ${API_PATH} that aren't categorised — add them to TOC in scripts/build-api-toc.mjs:\n  ${headerMissingToc.join(
      "\n  ",
    )}`,
  );
  process.exit(1);
}

// Build the TOC block. Markdown details/summary keeps the section
// scannable but compact; readers expand the bucket they need.
const lines = ["## Contents", ""];
for (const [category, symbols] of Object.entries(TOC)) {
  lines.push(`### ${category}`, "");
  for (const s of symbols) {
    lines.push(`- [\`${s}\`](#${anchor(s)})`);
  }
  lines.push("");
}
const tocBlock = lines.join("\n") + "\n";

// Insert after the H1. typedoc emits `# @machinen/runtime` as the
// first non-empty line; we splice the TOC right after the blank line
// that follows.
const out = md.replace(/^(# @machinen\/runtime\n)/, `$1\n${tocBlock}`);
if (out === md) {
  console.error(
    `build-api-toc: couldn't find the H1 in ${API_PATH} — typedoc output shape changed?`,
  );
  process.exit(1);
}

writeFileSync(API_PATH, out);
console.log(`Injected task-grouped TOC into ${API_PATH}`);
