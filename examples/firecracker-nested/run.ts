import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { boot } from "@machinen/runtime";

const FIRECRACKER_VERSION = "v1.15.1";
const FIRECRACKER_ARCH = "aarch64";
const FIRECRACKER_TARBALL_SHA256 =
  "00654ac1e702a22744121ea9f10a4f792ebd7c3a744cba587dfac9fcb79b41a5";
const FIRECRACKER_TARBALL_MAX_BYTES = 16 * 1024 * 1024;
const FIRECRACKER_TAR_MAX_BYTES = 64 * 1024 * 1024;
const GUEST_MOUNT = "/mnt/firecracker";
const L2_SUCCESS_MARKER = "firecracker-nested-ok";
const L2_INITRAMFS_MAX_BYTES = 1024 * 1024;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const releaseAssets = join(repoRoot, "release-assets");
const kernelPath = join(releaseAssets, "Image-arm64");
const dtbPath = join(releaseAssets, "virt-arm64.dtb");
const rootfsPath = join(releaseAssets, "rootfs-debian-arm64.tar.gz");
const artifacts = join(here, "artifacts");
const firecrackerBinary = join(artifacts, "firecracker");
const firecrackerTarball = join(
  artifacts,
  `firecracker-${FIRECRACKER_VERSION}-${FIRECRACKER_ARCH}.tgz`,
);

async function main() {
  await prepareArtifacts();

  const marker = new MarkerScanner(L2_SUCCESS_MARKER);
  const vm = await boot({
    kernel: kernelPath,
    dtb: dtbPath,
    image: rootfsPath,
    cmd: [
      `${GUEST_MOUNT}/firecracker`,
      "--no-api",
      "--no-seccomp",
      "--config-file",
      `${GUEST_MOUNT}/fc-initrd.json`,
    ],
    liveMounts: [{ host: artifacts, guest: GUEST_MOUNT, mode: "ro" }],
    memory: 2048,
    nested: true,
  });

  teeAndScan(vm.stdout, process.stdout, marker);
  teeAndScan(vm.stderr, process.stderr, marker);
  process.on("SIGINT", () => void vm.kill());
  await vm.wait();

  if (!marker.seen) {
    throw new Error(
      `Firecracker booted, but the L2 success marker ${JSON.stringify(L2_SUCCESS_MARKER)} was not seen`,
    );
  }

  console.log("\nFirecracker ran inside machinen nested KVM.");
}

async function prepareArtifacts() {
  await assertFile(kernelPath, "machinen arm64 kernel", 128 * 1024 * 1024);
  await assertFile(dtbPath, "machinen arm64 DTB", 1024 * 1024);
  await assertFile(rootfsPath, "machinen arm64 rootfs", 1024 * 1024 * 1024);
  await assertTool("zig", ["version"]);
  await mkdir(artifacts, { recursive: true });
  await copyFile(kernelPath, join(artifacts, "Image-arm64"));
  await installFirecracker();
  await buildInitramfs();
  await writeConfig();
}

async function installFirecracker() {
  await ensureFirecrackerTarball();
  const tarball = await readFile(firecrackerTarball);
  assertSha256(tarball, FIRECRACKER_TARBALL_SHA256, firecrackerTarball);
  const tar = gunzipSync(tarball);
  if (tar.length > FIRECRACKER_TAR_MAX_BYTES) {
    throw new Error(
      `Firecracker archive expands to ${tar.length} bytes; max is ${FIRECRACKER_TAR_MAX_BYTES}`,
    );
  }

  const member = `release-${FIRECRACKER_VERSION}-${FIRECRACKER_ARCH}/firecracker-${FIRECRACKER_VERSION}-${FIRECRACKER_ARCH}`;
  const binary = extractTarMember(tar, member);
  await writeFile(firecrackerBinary, binary, { mode: 0o755 });
  await chmod(firecrackerBinary, 0o755);
}

async function ensureFirecrackerTarball() {
  if (await fileHasSha256(firecrackerTarball, FIRECRACKER_TARBALL_SHA256)) {
    return;
  }
  const bytes = await downloadFirecrackerTarball();
  const tmp = `${firecrackerTarball}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o644 });
  await rename(tmp, firecrackerTarball);
}

async function downloadFirecrackerTarball(): Promise<Buffer> {
  const url = `https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-${FIRECRACKER_ARCH}.tgz`;
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  assertHttpOk(response, url);
  const expectedBytes = requiredContentLength(response.headers, url);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertDownloadedLength(bytes.length, expectedBytes, url);
  assertSha256(bytes, FIRECRACKER_TARBALL_SHA256, url);
  return bytes;
}

function assertHttpOk(response: Response, url: string) {
  if (!response.ok) {
    throw new Error(`${url} download failed: ${response.status} ${response.statusText}`);
  }
}

function requiredContentLength(headers: Headers, label: string) {
  const size = Number(headers.get("content-length") ?? "0");
  assertPositiveInteger(size, `${label} content-length`);
  assertAtMost(size, FIRECRACKER_TARBALL_MAX_BYTES, `${label} content-length`);
  return size;
}

function assertDownloadedLength(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} downloaded ${actual} bytes; expected ${expected}`);
  }
  assertAtMost(actual, FIRECRACKER_TARBALL_MAX_BYTES, `${label} download`);
}

async function buildInitramfs() {
  const initSource = join(artifacts, "l2-init.c");
  const initBinary = join(artifacts, "init");
  const initramfs = join(artifacts, "initramfs.cpio");
  await writeFile(initSource, l2InitSource());
  await run("zig", [
    "cc",
    "-target",
    "aarch64-linux-musl",
    "-static",
    "-Os",
    "-s",
    initSource,
    "-o",
    initBinary,
  ]);

  const archive = makeNewcArchive([
    { name: "init", mode: 0o100755, data: await readFile(initBinary) },
  ]);
  if (archive.length > L2_INITRAMFS_MAX_BYTES) {
    throw new Error(`initramfs is ${archive.length} bytes; max is ${L2_INITRAMFS_MAX_BYTES}`);
  }
  await writeFile(initramfs, archive, { mode: 0o644 });
}

async function writeConfig() {
  const config = {
    "boot-source": {
      kernel_image_path: `${GUEST_MOUNT}/Image-arm64`,
      initrd_path: `${GUEST_MOUNT}/initramfs.cpio`,
      boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
    },
    drives: [],
    "network-interfaces": [],
    "machine-config": {
      vcpu_count: 1,
      mem_size_mib: 128,
    },
  };
  await writeFile(join(artifacts, "fc-initrd.json"), `${JSON.stringify(config, null, 2)}\n`);
}

interface TarEntry {
  name: string;
  type: number;
  data: Buffer;
  nextOffset: number;
}

function extractTarMember(tar: Buffer, name: string): Buffer {
  for (const entry of tarEntries(tar)) {
    if (entry.name !== name) {
      continue;
    }
    assertRegularTarEntry(entry, name);
    return Buffer.from(entry.data);
  }
  throw new Error(`Firecracker binary ${name} not found in release archive`);
}

function* tarEntries(tar: Buffer): Generator<TarEntry> {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const entry = readTarEntry(tar, offset);
    if (!entry) {
      return;
    }
    yield entry;
    offset = entry.nextOffset;
  }
}

function readTarEntry(tar: Buffer, offset: number): TarEntry | undefined {
  const header = tar.subarray(offset, offset + 512);
  if (isZeroBlock(header)) {
    return undefined;
  }
  const name = readTarEntryName(header);
  const size = readTarOctal(header, 124, 12);
  const dataStart = offset + 512;
  const dataEnd = dataStart + size;
  assertTarEntryBounds(tar, name, dataEnd);
  return {
    name,
    type: header[156],
    data: tar.subarray(dataStart, dataEnd),
    nextOffset: dataStart + roundUp512(size),
  };
}

function readTarEntryName(header: Buffer) {
  const entryName = readTarString(header, 0, 100);
  const prefix = readTarString(header, 345, 155);
  if (prefix) {
    return `${prefix}/${entryName}`;
  }
  return entryName;
}

function assertTarEntryBounds(tar: Buffer, name: string, dataEnd: number) {
  if (dataEnd > tar.length) {
    throw new Error(`tar entry ${name} overruns archive`);
  }
}

function assertRegularTarEntry(entry: TarEntry, expectedName: string) {
  if (entry.type !== 0 && entry.type !== 0x30) {
    throw new Error(`tar entry ${expectedName} is not a regular file`);
  }
}

function makeNewcArchive(entries: Array<{ name: string; mode: number; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  let ino = 1;
  for (const entry of entries) {
    appendNewcEntry(chunks, ino++, entry.name, entry.mode, entry.data);
  }
  appendNewcEntry(chunks, ino, "TRAILER!!!", 0, Buffer.alloc(0));
  return Buffer.concat(chunks);
}

function appendNewcEntry(chunks: Buffer[], ino: number, name: string, mode: number, data: Buffer) {
  if (name.length === 0 || name.includes("/") || name.includes("\0")) {
    throw new Error(`invalid initramfs entry name: ${JSON.stringify(name)}`);
  }
  assertUint32(ino, "cpio inode");
  assertUint32(mode, "cpio mode");
  assertUint32(data.length, "cpio file size");

  const nameBytes = Buffer.from(`${name}\0`);
  const header = Buffer.from(
    [
      "070701",
      hex32(ino),
      hex32(mode),
      hex32(0),
      hex32(0),
      hex32(1),
      hex32(0),
      hex32(data.length),
      hex32(0),
      hex32(0),
      hex32(0),
      hex32(0),
      hex32(nameBytes.length),
      hex32(0),
    ].join(""),
    "ascii",
  );
  chunks.push(
    header,
    nameBytes,
    Buffer.alloc(pad4(header.length + nameBytes.length)),
    data,
    Buffer.alloc(pad4(data.length)),
  );
}

async function assertFile(path: string, label: string, maxBytes: number) {
  const info = await stat(path).catch(() => {
    throw new Error(
      `missing ${label} at ${path}. Run from the repo after building release-assets.`,
    );
  });
  if (!info.isFile()) {
    throw new Error(`${label} is not a regular file: ${path}`);
  }
  if (info.size <= 0 || info.size > maxBytes) {
    throw new Error(`${label} size is ${info.size}; expected 1..${maxBytes} bytes: ${path}`);
  }
}

async function assertTool(command: string, args: string[]) {
  try {
    await run(command, args, { silent: true });
  } catch (error) {
    throw new Error(`${command} is required on PATH for this example`, { cause: error });
  }
}

async function fileHasSha256(path: string, expected: string) {
  try {
    assertSha256(await readFile(path), expected, path);
    return true;
  } catch {
    return false;
  }
}

function assertSha256(data: Buffer, expected: string, label: string) {
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) {
    throw new Error(`${label} sha256 mismatch: expected ${expected}, got ${actual}`);
  }
}

async function run(command: string, args: string[], opts: { silent?: boolean } = {}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: opts.silent ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited code=${code ?? "null"} signal=${signal ?? "null"}`,
          ),
        );
      }
    });
  });
}

function teeAndScan(
  stream: NodeJS.ReadableStream,
  out: NodeJS.WritableStream,
  marker: MarkerScanner,
) {
  stream.on("data", (chunk: Buffer) => {
    marker.observe(chunk);
    out.write(chunk);
  });
}

class MarkerScanner {
  #tail = "";
  seen = false;

  constructor(readonly marker: string) {
    if (marker.length === 0) {
      throw new Error("marker must not be empty");
    }
  }

  observe(chunk: Buffer) {
    if (this.seen) {
      return;
    }
    const text = this.#tail + chunk.toString("utf8");
    this.seen = text.includes(this.marker);
    this.#tail = text.slice(-Math.max(0, this.marker.length - 1));
  }
}

function readTarString(header: Buffer, start: number, length: number) {
  const end = header.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return header.toString("utf8", start, boundedEnd);
}

function readTarOctal(header: Buffer, start: number, length: number) {
  const raw = readTarString(header, start, length).trim();
  if (!/^[0-7]*$/.test(raw)) {
    throw new Error(`invalid tar octal field: ${JSON.stringify(raw)}`);
  }
  return raw === "" ? 0 : Number.parseInt(raw, 8);
}

function isZeroBlock(block: Buffer) {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function roundUp512(value: number) {
  return Math.ceil(value / 512) * 512;
}

function hex32(value: number) {
  assertUint32(value, "hex32 value");
  return value.toString(16).padStart(8, "0");
}

function assertUint32(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must fit in uint32, got ${value}`);
  }
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got ${value}`);
  }
  if (value <= 0) {
    throw new Error(`${label} must be positive, got ${value}`);
  }
}

function assertAtMost(value: number, max: number, label: string) {
  if (value > max) {
    throw new Error(`${label} must be <= ${max}, got ${value}`);
  }
}

function pad4(length: number) {
  return (4 - (length % 4)) % 4;
}

await main();

function l2InitSource() {
  return `#define _GNU_SOURCE
#include <linux/reboot.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/syscall.h>
#include <unistd.h>

static void put(const char *s) {
  const char *p = s;
  while (*p) p++;
  (void)write(1, s, (size_t)(p - s));
}

int main(void) {
  put("hello from firecracker L2 on aarch64\\n");
  put("firecracker-nested-ok\\n");
  sync();
  syscall(SYS_reboot, LINUX_REBOOT_MAGIC1, LINUX_REBOOT_MAGIC2,
          LINUX_REBOOT_CMD_POWER_OFF, 0);
  for (;;) syscall(SYS_exit, 0);
}
`;
}
