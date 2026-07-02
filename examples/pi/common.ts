import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const artifactDir = resolve("artifacts");
export const imagePath = resolve(artifactDir, "rootfs.tar.gz");
export const vmName = process.env.MACHINEN_PI_NAME ?? "pi";
export const workspaceHost = resolve(process.env.MACHINEN_PI_WORKSPACE ?? process.cwd());
export const piAgentHost = resolve(homedir(), ".pi/agent");

export function ensureArtifactDir() {
  mkdirSync(artifactDir, { recursive: true });
}

export function requirePiAuth() {
  if (existsSync(piAgentHost)) return;

  console.error(`${piAgentHost} not found.`);
  console.error("Install and authenticate pi on the host first:");
  console.error("  npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
  console.error("  pi");
  console.error("  /login");
  process.exit(1);
}

export function requireImage() {
  if (existsSync(imagePath)) return;

  console.error(`${imagePath} not found.`);
  console.error("Run `pnpm bake` in examples/pi first.");
  process.exit(1);
}

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
