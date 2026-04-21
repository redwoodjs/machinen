// TODO: remove once libslirp is statically linked into the VMM binary
// (see .docs/learnings/microvm/distribution-plan.md §libslirp).
//
// For now the VMM depends on a dynamically loaded libslirp.so. Probe
// the common multiarch paths and print a friendly hint if it's
// missing — cheaper than letting the user discover it via dlopen failure
// on first `machinen run`.

import { existsSync } from "node:fs";

// Workspace installs run postinstall for every workspace member
// regardless of os/cpu. Only probe when we're actually on linux.
if (process.platform !== "linux") {
  process.exit(0);
}

const candidates = [
  "/usr/lib/aarch64-linux-gnu/libslirp.so.0",
  "/usr/lib64/libslirp.so.0",
  "/usr/lib/libslirp.so.0",
];

if (!candidates.some((p) => existsSync(p))) {
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";
  process.stderr.write(
    `\n${yellow}@machinen/vmm-arm64-linux:${reset} libslirp not found.\n` +
      `  Install it before running the VMM:\n` +
      `    Debian/Ubuntu: apt install libslirp0\n` +
      `    Fedora/RHEL:   dnf install libslirp\n` +
      `    Alpine:        apk add libslirp\n\n`,
  );
}
