// TODO: remove once libslirp is statically linked into the VMM binary
// (see .docs/learnings/microvm/distribution-plan.md §libslirp).
//
// For now the VMM depends on a dynamically loaded libslirp.dylib. Probe
// the usual Homebrew locations and print a friendly hint if it's
// missing — cheaper than letting the user discover it via dlopen failure
// on first `machinen run`.

import { existsSync } from "node:fs";

// Workspace installs run postinstall for every workspace member
// regardless of os/cpu. Only probe when we're actually on darwin.
if (process.platform !== "darwin") process.exit(0);

const candidates = [
  "/opt/homebrew/lib/libslirp.dylib", // Apple Silicon
  "/usr/local/lib/libslirp.dylib", // Intel
];

if (!candidates.some((p) => existsSync(p))) {
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";
  process.stderr.write(
    `\n${yellow}@machinen/vmm-arm64-darwin:${reset} libslirp not found.\n` +
      `  Install it before running the VMM:\n` +
      `    brew install libslirp\n\n`,
  );
}
