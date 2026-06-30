// Inject a compact task-grouped table of contents in packages/runtime/API.md.

import { readFileSync, writeFileSync } from "node:fs";

// Optional path arg so the api-md-drift test can point at a tmpdir copy without
// clobbering the committed file. Defaults to the path `pnpm run build:docs` uses.
const API_PATH = process.argv[2] ?? "packages/runtime/API.md";

const TOC = {
  "VM lifecycle": [
    "boot",
    "attach",
    "restore",
    "measureFirstByte",
    "VmHandle",
    "BootOptions",
    "RestoreOptions",
    "SnapshotOptions",
    "SnapshotResult",
    "SnapshotEngine",
  ],
  "Provisioning and images": [
    "provision",
    "ProvisionOptions",
    "ProvisionResult",
    "ensureRootfsImage",
    "ensureMountDiskImage",
    "ensureMountDiskUpper",
    "warmImageConfigCache",
  ],
  "Guest services": [
    "VsockExec",
    "VsockFiles",
    "VsockSecrets",
    "VsockWinsize",
    "bootPty",
    "Sandboxes",
    "Supervisor",
  ],
  "Move PID translation": [
    "MOVE_DESCRIPTOR_FORMAT_VERSION",
    "MOVE_REFUSAL_CODE",
    "MoveDescriptor",
    "MoveIssueReport",
    "MovePidGraph",
    "MovePidGraphEdge",
    "MovePidGraphNode",
    "MoveProcessArchitecture",
    "MoveProcessRefusal",
    "MoveProcessResource",
    "MoveProcessStateClass",
    "MoveRefusalEvidence",
    "MoveSaveResult",
    "MoveTargetFdTableEntry",
    "MoveTargetGuestResourceRecipe",
    "buildMoveIssueReport",
    "createMoveDescriptor",
    "loadMoveDescriptor",
    "saveMoveDescriptor",
    "scanMovePidGraph",
  ],
  "Host resources": [
    "probeNestedVirtualization",
    "checkForkBackpressure",
    "readHostFreeBytes",
    "readHostTotalBytes",
    "readHostRssBytes",
    "readHostRssBytesMulti",
    "readBalloonStats",
  ],
  "Registry and cleanup": [
    "list",
    "registryRoot",
    "runGc",
    "validatePid",
    "bootSnapshotPath",
    "detachedLogRoot",
    "writeBootSnapshot",
  ],
  Initramfs: [
    "mkinitramfsBundle",
    "mkinitramfsTinyBundle",
    "mkinitramfsRootfs",
    "mkinitramfsWorkspace",
    "mkinitramfsMinimal",
    "mkinitramfsCli",
  ],
  Errors: [
    "MachinenError",
    "BootError",
    "ExecError",
    "SnapshotError",
    "ProvisionError",
    "RegistryError",
    "FilesError",
    "MountError",
    "SecretsError",
    "WinsizeError",
    "SandboxError",
    "CacheError",
    "GvproxyError",
    "MkinitramfsError",
    "ParseError",
    "ErrorCode",
    "isMachinenError",
    "formatMachinenError",
  ],
};

function anchor(symbol) {
  return symbol.toLowerCase().replaceAll(/[^a-z0-9_]/g, "");
}

function normalizeHeader(text) {
  return text.replaceAll("\\", "").replace(/\(\)$/, "");
}

const md = readFileSync(API_PATH, "utf8");
const h3s = new Set();
for (const line of md.split("\n")) {
  const match = /^### (.+)$/.exec(line);
  if (match) {
    h3s.add(normalizeHeader(match[1].trim()));
  }
}

const activeToc = Object.fromEntries(
  Object.entries(TOC)
    .map(([category, symbols]) => [category, symbols.filter((symbol) => h3s.has(symbol))])
    .filter(([, symbols]) => symbols.length > 0),
);
const categorized = new Set(Object.values(activeToc).flat());
const uncategorized = [...h3s].filter((symbol) => !categorized.has(symbol)).sort();
if (uncategorized.length > 0) {
  activeToc.Other = uncategorized;
}

const lines = ["## Contents", ""];
for (const [category, symbols] of Object.entries(activeToc)) {
  lines.push(`### ${category}`, "");
  for (const symbol of symbols) {
    lines.push(`- [\`${symbol}\`](#${anchor(symbol)})`);
  }
  lines.push("");
}
const tocBlock = `${lines.join("\n")}\n`;

const out = md.replace(/^(# @machinen\/runtime\n)/, `$1\n${tocBlock}`);
if (out === md) {
  console.error(`build-api-toc: couldn't find the H1 in ${API_PATH}`);
  process.exit(1);
}

writeFileSync(API_PATH, out);
console.log(`Injected task-grouped TOC into ${API_PATH}`);
