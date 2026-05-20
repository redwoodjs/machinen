import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  RuntimeAdapterBuild,
  RuntimeAdapterBuildModule,
  RuntimeAdapterRefusal,
} from "./runtime-adapter.ts";

export interface CaptureJsBuildIdentityOptions {
  rootDir: string;
  entrypoints: string[];
  packageJsonPath?: string;
  lockfilePath?: string;
  artifactPaths?: string[];
}

export interface JsBuildIdentityFile {
  path: string;
  sha256: string;
}

export interface JsBuildIdentitySidecar {
  formatVersion: 1;
  kind: "machinen-js-build-identity";
  rootDir: string;
  entrypoints: string[];
  files: JsBuildIdentityFile[];
  build: RuntimeAdapterBuild;
}

export type JsBuildIdentityVerification =
  | { accepted: true; current: JsBuildIdentitySidecar }
  | { accepted: false; current: JsBuildIdentitySidecar; refusal: RuntimeAdapterRefusal };

export function captureJsBuildIdentity(
  options: CaptureJsBuildIdentityOptions,
): JsBuildIdentitySidecar {
  const rootDir = resolve(options.rootDir);
  const entrypoints = options.entrypoints.map((entrypoint) => resolve(rootDir, entrypoint));
  const graph = collectModuleGraph(rootDir, entrypoints);
  const packageJson = optionalDigest(rootDir, options.packageJsonPath ?? "package.json");
  const lockfile = optionalDigest(rootDir, options.lockfilePath ?? "pnpm-lock.yaml");
  const artifacts = (options.artifactPaths ?? []).map((artifact) => digestFile(rootDir, artifact));
  const files = [...graph.files, ...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  const modules = graph.modules.sort((a, b) => a.specifier.localeCompare(b.specifier));
  return {
    formatVersion: 1,
    kind: "machinen-js-build-identity",
    rootDir,
    entrypoints: entrypoints.map((entrypoint) => relative(rootDir, entrypoint)),
    files,
    build: {
      identity: {
        sourceSha256: hashJson(files),
        packageSha256: packageJson?.sha256,
        lockfileSha256: lockfile?.sha256,
        moduleGraphSha256: hashJson(modules),
        artifactSha256: artifacts.length > 0 ? hashJson(artifacts) : undefined,
      },
      modules,
    },
  };
}

export function verifyJsBuildIdentity(
  expected: JsBuildIdentitySidecar,
  options: CaptureJsBuildIdentityOptions,
): JsBuildIdentityVerification {
  const current = captureJsBuildIdentity(options);
  const field = firstMismatchedField(expected.build.identity, current.build.identity);
  if (!field && expected.build.modules.length === current.build.modules.length) {
    return { accepted: true, current };
  }
  return {
    accepted: false,
    current,
    refusal: {
      code: "target-build-mismatch",
      message: `JavaScript build identity mismatch${field ? ` at ${field}` : " in module graph"}`,
      detail: {
        field: field ?? "modules",
        expected: expected.build.identity,
        current: current.build.identity,
      },
    },
  };
}

function collectModuleGraph(rootDir: string, entrypoints: string[]) {
  const files = new Map<string, JsBuildIdentityFile>();
  const modules = new Map<string, RuntimeAdapterBuildModule>();
  const pending = [...entrypoints];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file) || !existsSync(file) || !statSync(file).isFile()) {
      continue;
    }
    visited.add(file);
    const rel = relative(rootDir, file);
    const source = readFileSync(file, "utf8");
    files.set(rel, { path: rel, sha256: sha256(source) });
    modules.set(rel, { specifier: rel, kind: "relative", sha256: sha256(source) });
    for (const specifier of importSpecifiers(source)) {
      const kind = moduleKind(specifier);
      if (kind !== "relative") {
        modules.set(specifier, { specifier, kind });
        continue;
      }
      const resolved = resolveRelativeModule(dirname(file), specifier);
      modules.set(specifier, {
        specifier,
        kind,
        sha256: resolved ? sha256(readFileSync(resolved)) : undefined,
      });
      if (resolved) {
        pending.push(resolved);
      }
    }
  }
  return { files: [...files.values()], modules: [...modules.values()] };
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]!);
}

function moduleKind(specifier: string): RuntimeAdapterBuildModule["kind"] {
  if (specifier.startsWith("node:")) {
    return "builtin";
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return "relative";
  }
  if (specifier.startsWith("@machinen/")) {
    return "workspace";
  }
  return "external";
}

function resolveRelativeModule(fromDir: string, specifier: string): string | undefined {
  const base = isAbsolute(specifier) ? specifier : resolve(fromDir, specifier);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".mjs", ".cjs"].map((suffix) => `${base}${suffix}`),
    ...["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"].map((name) =>
      join(base, name),
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function optionalDigest(rootDir: string, path: string): JsBuildIdentityFile | undefined {
  const full = resolve(rootDir, path);
  if (!existsSync(full)) {
    return undefined;
  }
  return digestFile(rootDir, path);
}

function digestFile(rootDir: string, path: string): JsBuildIdentityFile {
  const full = resolve(rootDir, path);
  return { path: relative(rootDir, full), sha256: sha256(readFileSync(full)) };
}

function firstMismatchedField(
  expected: RuntimeAdapterBuild["identity"],
  current: RuntimeAdapterBuild["identity"],
): string | undefined {
  for (const field of [
    "sourceSha256",
    "packageSha256",
    "lockfileSha256",
    "moduleGraphSha256",
    "artifactSha256",
  ] as const) {
    if (expected[field] !== current[field]) {
      return field;
    }
  }
  return undefined;
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
