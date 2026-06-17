import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, cpus, freemem, hostname, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, resolve } from "node:path";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface Stats {
  n: number;
  min: number;
  avg: number;
  med: number;
  p95: number;
  max: number;
  sum: number;
}

export interface RootdiskCopyEvent {
  name: string;
  mode: string;
  primitive: string;
  fallbackReason: string;
  bytes: number;
  elapsedMs: number;
}

export type BenchmarkEnvironment = "disk" | "ramdisk";

export function parseBenchmarkEnvironment(value: string | undefined): BenchmarkEnvironment {
  if (value === "disk" || value === "ramdisk") {
    return value;
  }
  console.error(`bench: --environment must be disk or ramdisk (got ${value})`);
  process.exit(2);
}

export interface FilesystemMetadataPaths {
  repoRoot: string;
  assets: string;
  rootfsImgCache: string;
  outputPath?: string;
}

export interface AssetMetadataInput {
  guestArch: string;
  kernel: string;
  dtb?: string;
  image: string;
}

export function hostMetadata(): JsonValue {
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu_model: cpus()[0]?.model ?? null,
    cpu_count: cpus().length,
    total_memory_bytes: totalmem(),
    free_memory_bytes_at_start: freemem(),
  };
}

export function assetMetadata(assets: AssetMetadataInput): JsonValue {
  return {
    guest_arch: assets.guestArch,
    kernel: fileMetadata(assets.kernel),
    dtb: assets.dtb ? fileMetadata(assets.dtb) : null,
    image: fileMetadata(assets.image),
  };
}

function fileMetadata(path: string): JsonValue {
  const stat = statSync(path);
  return {
    path,
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256_sidecar: readSidecar(`${path}.sha256`),
    inputs_sha256_sidecar: readSidecar(`${path}.inputs-sha256`),
  };
}

function readSidecar(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8").trim() || null;
}

export function filesystemMetadata(paths: FilesystemMetadataPaths): JsonValue {
  return {
    repo: filesystemInfo(paths.repoRoot),
    tmp: filesystemInfo(tmpdir()),
    assets: filesystemInfo(paths.assets),
    rootfs_img_cache: filesystemInfo(paths.rootfsImgCache),
    benchmark_output: paths.outputPath ? filesystemInfo(dirname(paths.outputPath)) : null,
  };
}

export function validateBenchmarkEnvironment(
  environment: BenchmarkEnvironment,
  filesystems: JsonValue,
): void {
  if (environment === "disk") {
    return;
  }
  const failures = ramdiskValidationFailures(filesystems);
  if (failures.length === 0) {
    return;
  }
  throw new Error(
    "bench: --environment ramdisk requires repo, tmp, assets, rootfs image cache" +
      `, and benchmark output (when --json/--json-dir is used) to be on tmpfs; ${failures.join("; ")}. ` +
      "Run from a tmpfs checkout and set HOME/TMPDIR inside that tmpfs.",
  );
}

function ramdiskValidationFailures(filesystems: JsonValue): string[] {
  const failures = RAMDISK_REQUIRED_FILESYSTEMS.flatMap((key) => tmpfsFailure(filesystems, key));
  return filesystemSection(filesystems, "benchmark_output") === undefined
    ? failures
    : [...failures, ...tmpfsFailure(filesystems, "benchmark_output")];
}

function tmpfsFailure(filesystems: JsonValue, key: string): string[] {
  const fstype = filesystemFstype(filesystems, key);
  return fstype === "tmpfs" ? [] : [`${key} fstype=${fstype ?? "unknown"}`];
}

function filesystemFstype(filesystems: JsonValue, key: string): string | undefined {
  const mount = jsonObject(filesystemSection(filesystems, key)?.mount);
  const fstype = mount?.fstype;
  return typeof fstype === "string" ? fstype : undefined;
}

function filesystemSection(
  filesystems: JsonValue,
  key: string,
): { [key: string]: JsonValue } | undefined {
  const section = jsonObject(filesystems)?.[key];
  return jsonObject(section);
}

function jsonObject(value: JsonValue | undefined): { [key: string]: JsonValue } | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

const RAMDISK_REQUIRED_FILESYSTEMS = ["repo", "tmp", "assets", "rootfs_img_cache"];

function filesystemInfo(path: string): JsonValue {
  const probePath = nearestExistingPath(path);
  const out: { [key: string]: JsonValue } = {
    path,
    exists: existsSync(path),
    probe_path: probePath,
  };
  const mount = findmntInfo(probePath);
  if ("error" in mount) {
    out.mount = null;
    out.error = mount.error;
    return out;
  }
  out.mount = mount.value;
  return out;
}

function nearestExistingPath(path: string): string {
  let cur = resolve(path);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) {
      return cur;
    }
    cur = parent;
  }
  return cur;
}

function findmntInfo(path: string): { value: JsonValue } | { error: string } {
  try {
    return findmntOutputInfo(runFindmnt(path));
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function runFindmnt(path: string): string {
  return execFileSync(
    "findmnt",
    ["-J", "-T", path, "-o", "TARGET,SOURCE,FSTYPE,OPTIONS,SIZE,USED,AVAIL"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function findmntOutputInfo(raw: string): { value: JsonValue } | { error: string } {
  const parsed = JSON.parse(raw) as { filesystems?: Array<Record<string, string>> };
  const fs = parsed.filesystems?.[0];
  return fs ? { value: findmntFilesystemJson(fs) } : { error: "findmnt returned no filesystem" };
}

function findmntFilesystemJson(fs: Record<string, string>): JsonValue {
  return Object.fromEntries(FINDMNT_FIELDS.map((field) => [field, fs[field] ?? null]));
}

const FINDMNT_FIELDS = ["target", "source", "fstype", "options", "size", "used", "avail"];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseRootdiskCopyEvents(captured: string): RootdiskCopyEvent[] {
  const events: RootdiskCopyEvent[] = [];
  for (const line of captured.split("\n")) {
    const event = parseRootdiskCopyEvent(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function parseRootdiskCopyEvent(line: string): RootdiskCopyEvent | undefined {
  const marker = "rootdisk-materialize event=reflink-copy";
  const idx = line.indexOf(marker);
  if (idx < 0) {
    return undefined;
  }
  const fields = parseKeyValueFields(line.slice(idx + "rootdisk-materialize ".length));
  return rootdiskCopyEventFromFields(fields);
}

function parseKeyValueFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const token of text.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      fields.set(token.slice(0, eq), token.slice(eq + 1));
    }
  }
  return fields;
}

function rootdiskCopyEventFromFields(fields: Map<string, string>): RootdiskCopyEvent | undefined {
  return fields.get("event") === "reflink-copy"
    ? {
        name: stringField(fields, "name"),
        mode: stringField(fields, "mode"),
        primitive: stringField(fields, "primitive"),
        fallbackReason: stringField(fields, "fallbackReason"),
        bytes: integerField(fields, "bytes"),
        elapsedMs: integerField(fields, "elapsedMs"),
      }
    : undefined;
}

function stringField(fields: Map<string, string>, key: string): string {
  return fields.get(key) ?? "unknown";
}

function integerField(fields: Map<string, string>, key: string): number {
  return Number.parseInt(fields.get(key) ?? "0", 10);
}

export function rootdiskCopyJson(copies: RootdiskCopyEvent[]): JsonValue | undefined {
  if (copies.length === 0) {
    return undefined;
  }
  return {
    n: copies.length,
    by_name: countBy(copies.map((copy) => copy.name)) as unknown as JsonValue,
    by_mode: countBy(copies.map((copy) => copy.mode)) as unknown as JsonValue,
    by_primitive: countBy(copies.map((copy) => copy.primitive)) as unknown as JsonValue,
    fallback_reasons: countBy(copies.map((copy) => copy.fallbackReason)) as unknown as JsonValue,
    bytes: stats(copies.map((copy) => copy.bytes)) as unknown as JsonValue,
    elapsed_ms: stats(copies.map((copy) => copy.elapsedMs)) as unknown as JsonValue,
  };
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, x) => s + x, 0);
  return {
    n,
    min: sampleAt(sorted, 0),
    avg: n === 0 ? 0 : sum / n,
    med: sampleAt(sorted, Math.floor(n / 2)),
    p95: sampleAt(sorted, Math.min(n - 1, Math.floor(n * 0.95))),
    max: sampleAt(sorted, n - 1),
    sum,
  };
}

function sampleAt(samples: number[], index: number): number {
  return samples[index] ?? 0;
}
