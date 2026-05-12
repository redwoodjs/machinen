// Sync README.md + docs/ + examples/ + package API references from
// this repo into a checkout of redwoodjs/machinen.dev with the
// transformations needed to make the content stand alone in the
// public repo:
//
//   - Top-level README: drop the "First run fetches… gh auth login"
//     paragraph (assets are public now) and the Contributing section
//     (CONTRIBUTING.md / RELEASING.md aren't in machinen.dev).
//     Rewrite the Documentation section's `./packages/{cli,runtime}/API.md`
//     paths to point at the copies under `./docs/api/` and append a
//     pointer at the runnable examples. Repoint the FSL link.
//
//   - docs/ copied verbatim. The README's `<img src="./docs/logo.svg">`
//     keeps working because the logo travels with it.
//
//   - packages/cli/API.md → docs/api/cli.md; same for runtime.
//
//   - Per-example package.json: rename `@machinen/example-*` →
//     `machinen-example-*` (avoids npm-org confusion since these aren't
//     published), repoint `@machinen/runtime` from `workspace:*` →
//     `latest`, drop the `--conditions=source` flag (no `source`
//     export in the published package), add tsx as a devDependency.
//
//   - Per-example README: drop the `pnpm -F @machinen/example-X`
//     filter syntax (no workspace in machinen.dev) and fix the
//     quickstart's link to `../../docs/quickstart.md`.
//
// Usage: node scripts/sync-machinen-dev.mjs <machinen-dev-checkout>
//
// Called from .github/workflows/release.yml on every published release.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: node scripts/sync-machinen-dev.mjs <machinen-dev-checkout>");
  process.exit(1);
}

// ---------- README ---------------------------------------------------

let readme = readFileSync("README.md", "utf8");
const original = readme;

// Rewrite the Documentation section: repoint API.md links at
// `./docs/api/` (where the sync copies them) and append a pointer at
// the runnable examples so it lives next to the static docs.
const docsSection = `## Documentation

- [Quickstart](./docs/quickstart.md) — the same three-step walkthrough
  with more colour
- [Guides](./docs/) — recipes for creating VMs, snapshots and forks,
  mounts, and networking
- [\`@machinen/cli\` reference](./docs/api/cli.md) — every command
  and flag
- [\`@machinen/runtime\` reference](./docs/api/runtime.md) — every
  exported function, type, and error class (typedoc-generated)

Three runnable demos live in [\`examples/\`](./examples):

- [\`quickstart\`](./examples/quickstart) — the counter walkthrough above
  as a runnable repo.
- [\`fork-pi\`](./examples/fork-pi) — snapshot a VM with the \`pi\` coding
  agent installed, then fork three siblings that each answer a different
  prompt in parallel.
- [\`live-mount\`](./examples/live-mount) — host directory mounted into
  the guest over a FUSE-over-vsock channel; bidirectional, no rebuild
  on edit.

`;
readme = readme.replace(/## Documentation\s*\n[\s\S]*?(?=## Other ways to boot)/, docsSection);

// Drop the Contributing section.
readme = readme.replace(/## Contributing[\s\S]*?(?=## License)/, "");

// Repoint the FSL license link (LICENSE file isn't in machinen.dev).
readme = readme.replace(/\[FSL-1\.1-MIT\]\(\.\/LICENSE\)/, "[FSL-1.1-MIT](https://fsl.software/)");

// Fail loudly if the source README's shape changed and the regexes
// silently no-op'd. These markers must not survive the rewrite.
const forbidden = [
  "./packages/cli/API.md",
  "./packages/runtime/API.md",
  "## Contributing",
  "(./LICENSE)",
  // Defensive — the source repo is private, so any link to
  // github.com/redwoodjs/machinen/* 404s for the public reader.
  "github.com/redwoodjs/machinen/",
];
for (const marker of forbidden) {
  if (readme.includes(marker)) {
    console.error(`README sync: forbidden marker survived rewrite: ${JSON.stringify(marker)}`);
    process.exit(1);
  }
}
if (readme === original) {
  console.error("README sync: no transformations applied — regexes likely out of date.");
  process.exit(1);
}

writeFileSync(join(dest, "README.md"), readme);

// ---------- docs + API refs ------------------------------------------

const docsDest = join(dest, "docs");
rmSync(docsDest, { recursive: true, force: true });
mkdirSync(join(docsDest, "api"), { recursive: true });

cpSync("docs", docsDest, { recursive: true });

// Typedoc-generated references for the two consumer-facing packages.
// The README links them as ./docs/api/{cli,runtime}.md.
cpSync("packages/cli/API.md", join(docsDest, "api", "cli.md"));
cpSync("packages/runtime/API.md", join(docsDest, "api", "runtime.md"));

// ---------- Examples -------------------------------------------------

const examplesDest = join(dest, "examples");
rmSync(examplesDest, { recursive: true, force: true });
mkdirSync(examplesDest, { recursive: true });

const exclude = new Set([
  "node_modules",
  "artifacts",
  ".cache",
  ".DS_Store",
  ".claude",
  "access.log",
  // Each private example package gets a patch-bump CHANGELOG.md from
  // `changeset version` whenever runtime/cli bump. Internal-only noise
  // — the examples don't publish, so the changelogs don't belong in
  // the public repo.
  "CHANGELOG.md",
]);
cpSync("examples", examplesDest, {
  recursive: true,
  filter: (src) => !exclude.has(src.split("/").pop()),
});

for (const entry of readdirSync(examplesDest, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const dir = join(examplesDest, entry.name);

  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.name = pkg.name.replace(/^@machinen\/example-/, "machinen-example-");
    if (pkg.dependencies?.["@machinen/runtime"]) {
      pkg.dependencies["@machinen/runtime"] = "latest";
    }
    if (pkg.scripts) {
      for (const k of Object.keys(pkg.scripts)) {
        pkg.scripts[k] = pkg.scripts[k].replace(/--conditions=source\s+/, "");
      }
    }
    pkg.devDependencies = { ...pkg.devDependencies, tsx: "^4" };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  const readmePath = join(dir, "README.md");
  if (existsSync(readmePath)) {
    let r = readFileSync(readmePath, "utf8");
    r = r.replace(/pnpm -F @machinen\/example-[^ ]+ /g, "pnpm ");
    r = r.replace(
      /Runnable companion to \[docs\/quickstart\.md\]\(\.\.\/\.\.\/docs\/quickstart\.md\)/g,
      "Runnable companion to the [quickstart in the top-level README](../../README.md#quickstart)",
    );
    writeFileSync(readmePath, r);
  }
}

console.log(`Synced README + docs + examples to ${dest}`);
