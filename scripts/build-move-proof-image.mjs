#!/usr/bin/env node
/** Build a disposable proof-only rootfs for scripts/smoke/move-envelope-matrix.sh. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT_VERSION = 2;
const REQUIRED_PACKAGES = [
  "libpython3.11-minimal",
  "python3.11-minimal",
  "libpython3.11-stdlib",
  "python3.11",
  "python3-minimal",
  "python3",
  "procps",
  "less",
  "vim-tiny",
  "util-linux",
  "perl",
  "nodejs",
  "busybox",
  "netcat-openbsd",
  "socat",
  "rsync",
  "redis-server",
  "redis-tools",
  "nginx",
  "php-cli",
  "ruby",
  "postgresql-15",
  "postgresql-client-15",
  "golang-go",
  "rustc",
  "xz-utils",
  "zstd",
  "gzip",
  "zip",
  "unzip",
  "tar",
  "tree",
];
const OPTIONAL_PACKAGES = ["caddy"];

const options = parseArgs(process.argv.slice(2));
const arch = options.arch ?? hostArch();
const baseImage = resolve(
  options["base-image"] ?? join("release-assets", `rootfs-debian-${arch}.tar.gz`),
);
if (!existsSync(baseImage)) {
  fail(`base image not found: ${baseImage}`);
}
const outDir = resolve(options["out-dir"] ?? join(".cache", "move-proof-image"));
mkdirSync(outDir, { recursive: true });
const cacheKey = digestForBuild(baseImage, arch);
const outputPath = resolve(
  options.output ?? join(outDir, `move-proof-image-${arch}-${cacheKey.slice(0, 12)}.tar.gz`),
);

if (existsSync(outputPath) && !options.force) {
  emit({ state: "cached", arch, baseImage, outputPath, packages: packageSummary() });
  process.exit(0);
}

assertDockerAvailable();
const workDir = makeWorkDir(outDir);
try {
  copyFileSync(baseImage, join(workDir, "base-rootfs.tar.gz"));
  writeFileSync(join(workDir, "build.sh"), dockerBuildScript(arch));
  runDockerBuild(workDir, arch);
  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(join(workDir, "output.tar.gz"), outputPath);
  emit({ state: "built", arch, baseImage, outputPath, packages: packageSummary() });
} finally {
  if (!options.keepWork) {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const parsed = { force: false, json: false, keepWork: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--arch") {
      parsed.arch = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--base-image") {
      parsed["base-image"] = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--out-dir") {
      parsed["out-dir"] = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--output") {
      parsed.output = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--keep-work") {
      parsed.keepWork = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (parsed.arch && !["arm64", "amd64"].includes(parsed.arch)) {
    fail(`--arch must be arm64 or amd64, got ${parsed.arch}`);
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function hostArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  fail(`unsupported host arch for default proof image arch: ${process.arch}`);
}

function digestForBuild(path, arch) {
  const hash = createHash("sha256");
  hash.update(`move-proof-image-v${SCRIPT_VERSION}\narch=${arch}\n`);
  hash.update(`required=${REQUIRED_PACKAGES.join(",")}\noptional=${OPTIONAL_PACKAGES.join(",")}\n`);
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function packageSummary() {
  return { required: REQUIRED_PACKAGES, optional: OPTIONAL_PACKAGES };
}

function assertDockerAvailable() {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
  } catch {
    fail("docker is required to build the disposable move proof image");
  }
}

function makeWorkDir(outDir) {
  const parent = existsSync(outDir) ? outDir : tmpdir();
  const path = join(parent, `.move-proof-image-${process.pid}-${Date.now()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function runDockerBuild(workDir, arch) {
  const platform = arch === "amd64" ? "linux/amd64" : "linux/arm64";
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--privileged",
      "--platform",
      platform,
      "-v",
      `${workDir}:/work`,
      "debian:bookworm-slim",
      "bash",
      "/work/build.sh",
    ],
    { stdio: "inherit" },
  );
}

function dockerBuildScript(arch) {
  const outputInWork = "/work/output.tar.gz";
  const marker = JSON.stringify(
    {
      kind: "machinen.move-proof-image",
      proofOnly: true,
      arch,
      scriptVersion: SCRIPT_VERSION,
      requiredPackages: REQUIRED_PACKAGES,
      optionalPackages: OPTIONAL_PACKAGES,
    },
    null,
    2,
  ).replaceAll("'", "'\\''");
  return `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates gzip tar mount >/tmp/move-proof-host-apt.log 2>&1 || { cat /tmp/move-proof-host-apt.log; exit 1; }
ROOTFS=/tmp/move-proof-rootfs
rm -rf "$ROOTFS"
mkdir -p "$ROOTFS"
tar -xzf /work/base-rootfs.tar.gz -C "$ROOTFS"
mkdir -p "$ROOTFS/proc" "$ROOTFS/sys" "$ROOTFS/dev" "$ROOTFS/tmp" "$ROOTFS/usr/share/machinen/proof-fixtures"
chmod 1777 "$ROOTFS/tmp"
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf" || true
cleanup() {
  umount -l "$ROOTFS/proc" >/dev/null 2>&1 || true
  umount -l "$ROOTFS/sys" >/dev/null 2>&1 || true
  umount -l "$ROOTFS/dev" >/dev/null 2>&1 || true
}
trap cleanup EXIT
mount -t proc proc "$ROOTFS/proc"
mount --rbind /sys "$ROOTFS/sys"
mount --rbind /dev "$ROOTFS/dev"
chroot "$ROOTFS" /bin/sh -lc 'set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/move-proof-image-apt-update.log 2>&1
apt-get install -y --reinstall --no-install-recommends ${REQUIRED_PACKAGES.join(" ")} >/tmp/move-proof-image-apt-install.log 2>&1 || { cat /tmp/move-proof-image-apt-install.log; exit 1; }
for package in ${OPTIONAL_PACKAGES.join(" ")}; do
  if apt-cache show "$package" >/dev/null 2>&1; then
    apt-get install -y --reinstall --no-install-recommends "$package" >>/tmp/move-proof-image-apt-install.log 2>&1 || { cat /tmp/move-proof-image-apt-install.log; exit 1; }
  else
    echo "optional proof package unavailable: $package" >&2
  fi
done
apt-get clean
rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /tmp/move-proof-image-apt-*.log'
printf '%s\n' '${marker}' >"$ROOTFS/usr/share/machinen/proof-fixtures/move-proof-image.json"
cleanup
trap - EXIT
rm -rf "$ROOTFS/proc"/* "$ROOTFS/sys"/* "$ROOTFS/dev"/*
tar --numeric-owner --sort=name --mtime='UTC 2020-01-01' -C "$ROOTFS" -cf - . | gzip -n > '${outputInWork}'
`;
}

function emit(summary) {
  const localOutput = join(workDirNameFromOutput(outputPath), basename(outputPath));
  const result = {
    ...summary,
    outputPath: existsSync(summary.outputPath) ? summary.outputPath : localOutput,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.state}: ${result.outputPath}`);
  }
}

function workDirNameFromOutput(path) {
  return dirname(path);
}

function printHelp() {
  console.log(`Usage: node scripts/build-move-proof-image.mjs [options]

Builds a disposable proof-only Machinen rootfs tarball for the move-envelope matrix.
It does not modify release assets, packages/native-* assets, or runtime defaults.

Options:
  --arch arm64|amd64       Guest/rootfs architecture (default: host arch)
  --base-image path        Base Machinen Debian rootfs tarball
  --out-dir path           Cache/output directory (default: .cache/move-proof-image)
  --output path            Exact output tar.gz path
  --force                  Rebuild even if the cached image exists
  --json                   Print machine-readable summary
  --keep-work              Keep temporary build directory
`);
}

function fail(message) {
  console.error(`build-move-proof-image: ${message}`);
  process.exit(2);
}
