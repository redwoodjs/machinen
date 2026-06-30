import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { WinsizeError } from "../errors.ts";

const WINSIZE_NAME = "machinen-winsize";
const require_ = createRequire(import.meta.url);

export function resolveWinsizeShim(): string {
  return resolveWinsizeShimEnvOverride() ?? findBundledWinsizeShim() ?? missingWinsizeShim();
}

function resolveWinsizeShimEnvOverride(): string | undefined {
  const envOverride = process.env.MACHINEN_WINSIZE;
  if (!envOverride) {
    return undefined;
  }
  if (existsSync(envOverride)) {
    return envOverride;
  }
  throw new WinsizeError(
    "WINSIZE_AGENT_UNAVAILABLE",
    `MACHINEN_WINSIZE=${envOverride} is set but that file does not exist.`,
    { retryable: false },
  );
}

function findBundledWinsizeShim(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${platform()}`;
  try {
    const mod = require_(pkg) as { winsize?: string };
    if (mod.winsize && existsSync(mod.winsize)) {
      return mod.winsize;
    }
  } catch {
    // Optional dep not installed for this arch+os.
  }
  return undefined;
}

function missingWinsizeShim(): never {
  throw new WinsizeError(
    "WINSIZE_AGENT_UNAVAILABLE",
    `${WINSIZE_NAME} was not found. Build it with scripts/build-runtime-helper.sh, install the matching @machinen/native-* package, or set MACHINEN_WINSIZE=/abs/path/to/${WINSIZE_NAME}.`,
    { retryable: false },
  );
}
