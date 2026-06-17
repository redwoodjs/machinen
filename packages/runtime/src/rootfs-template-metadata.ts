import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import debugLib from "debug";

const debug = debugLib("machinen:rootfs-img");

export function okMarkerPath(imgPath: string): string {
  return `${imgPath}.ok`;
}

export function templateMetaPath(imgPath: string): string {
  return `${imgPath}.meta.json`;
}

export type RootfsTemplateSource = "materialize" | "prebake" | "prebake-tree" | "legacy-fsck";

export interface RootfsTemplateMetadata {
  version: 1;
  sha256: string;
  sizeBytes: number;
  source: RootfsTemplateSource;
  createdAt: string;
}

export function readSha256Sidecar(tarAbs: string): string | undefined {
  const sidecar = `${tarAbs}.sha256`;
  if (!existsSync(sidecar)) {
    return undefined;
  }
  try {
    const first = readFileSync(sidecar, "utf8").trim().split(/\s+/, 1)[0]?.toLowerCase();
    return first && /^[0-9a-f]{64}$/.test(first) ? first : undefined;
  } catch (err) {
    debug("sha256 sidecar unreadable sidecar=%s err=%s", sidecar, (err as Error).message);
    return undefined;
  }
}

export function sha256OfFile(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    while (true) {
      const nread = readSync(fd, buf, 0, buf.length, null);
      if (nread <= 0) {
        break;
      }
      h.update(buf.subarray(0, nread));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

export function readVerifiedTemplateMetadata(paths: {
  metaPath: string;
  imgPath: string;
  sha: string;
}): RootfsTemplateMetadata | undefined {
  if (!existsSync(paths.metaPath)) {
    return undefined;
  }
  try {
    const meta = JSON.parse(
      readFileSync(paths.metaPath, "utf8"),
    ) as Partial<RootfsTemplateMetadata>;
    if (meta.version !== 1 || meta.sha256 !== paths.sha || typeof meta.sizeBytes !== "number") {
      return undefined;
    }
    const currentSize = statSync(paths.imgPath).size;
    return currentSize >= meta.sizeBytes ? (meta as RootfsTemplateMetadata) : undefined;
  } catch (err) {
    debug("template metadata invalid meta=%s err=%s", paths.metaPath, (err as Error).message);
    return undefined;
  }
}

export function writeTemplateMetadata(
  paths: { sha: string; imgPath: string; metaPath: string },
  source: RootfsTemplateSource,
): void {
  try {
    const meta: RootfsTemplateMetadata = {
      version: 1,
      sha256: paths.sha,
      sizeBytes: statSync(paths.imgPath).size,
      source,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(paths.metaPath, `${JSON.stringify(meta)}\n`);
  } catch (err) {
    debug("template metadata write failed img=%s err=%s", paths.imgPath, (err as Error).message);
  }
}
