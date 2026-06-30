import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { BootError } from "../errors.ts";

const PTY_NAME = "machinen-pty";
const require_ = createRequire(import.meta.url);

export function resolvePtyShim(): string {
  return resolvePtyShimEnvOverride() ?? findBundledPtyShim() ?? missingPtyShim();
}

function resolvePtyShimEnvOverride(): string | undefined {
  const envOverride = process.env.MACHINEN_PTY;
  if (!envOverride) {
    return undefined;
  }
  if (existsSync(envOverride)) {
    return envOverride;
  }
  throw new BootError(
    "BOOT_VMM_PACKAGE_BROKEN",
    `MACHINEN_PTY=${envOverride} is set but that file does not exist.`,
  );
}

function findBundledPtyShim(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${platform()}`;
  try {
    const mod = require_(pkg) as { pty?: string };
    if (mod.pty && existsSync(mod.pty)) {
      return mod.pty;
    }
  } catch {
    // Optional dep not installed for this arch+os.
  }
  return undefined;
}

function missingPtyShim(): never {
  throw new BootError(
    "BOOT_VMM_PACKAGE_BROKEN",
    `${PTY_NAME} was not found. Build it with scripts/build-runtime-helper.sh, install the matching @machinen/native-* package, or set MACHINEN_PTY=/abs/path/to/${PTY_NAME}.`,
  );
}
