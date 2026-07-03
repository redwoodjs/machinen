import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import debugLib from "debug";

const debug = debugLib("machinen:boot");

// #94: always wire up a vsock UDS bridge so `vm.exec()` works out of
// the box. Callers who set their own `MACHINEN_VSOCK` (e.g. the build
// flow) win — we parse their spec to extract the UDS path for exec.
export function setupVsockBridge(env: Record<string, string>): {
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
} {
  const existingSpec = env.MACHINEN_VSOCK;
  if (existingSpec !== undefined) {
    return callerVsockBridge(existingSpec);
  }
  return autoVsockBridge(env);
}

function callerVsockBridge(existingSpec: string): {
  vsockUdsPath: string | undefined;
  vsockTempDir: undefined;
} {
  const vsockUdsPath = parseVsockUdsPath(existingSpec);
  debug("vsock spec from caller env: %s (uds=%s)", existingSpec, vsockUdsPath ?? "<unparsed>");
  return { vsockUdsPath, vsockTempDir: undefined };
}

function autoVsockBridge(env: Record<string, string>): {
  vsockUdsPath: string;
  vsockTempDir: string;
} {
  const vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
  const vsockUdsPath = join(vsockTempDir, "exec.sock");
  env.MACHINEN_VSOCK = `in:1978:${vsockUdsPath}`;
  debug("vsock auto spec=%s uds=%s", env.MACHINEN_VSOCK, vsockUdsPath);
  return { vsockUdsPath, vsockTempDir };
}

function parseVsockUdsPath(spec: string): string | undefined {
  for (const entry of spec.split(",")) {
    const parsed = parseVsockEntry(entry);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function parseVsockEntry(entry: string): string | undefined {
  const firstColon = entry.indexOf(":");
  if (firstColon < 0) {
    return undefined;
  }
  const rest = entry.slice(firstColon + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon < 0) {
    return undefined;
  }
  return parseVsockPortAndPath(rest.slice(0, secondColon), rest.slice(secondColon + 1));
}

function parseVsockPortAndPath(port: string, path: string): string | undefined {
  if (/^\d+$/.test(port) && path.length > 0) {
    return path;
  }
  return undefined;
}
