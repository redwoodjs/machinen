// Parent-death-binding shim for child processes (#115).
//
// Node's `child_process.spawn` has no way to say "die when I die." The
// runtime uses a native pdeathsig wrapper for gvproxy and the VMM so a
// killed parent does not leave host sidecars orphaned. The wrapper is
// built in packages/runtime/native and shipped through @machinen/native-*.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform as osPlatform } from "node:os";
import debugLib from "debug";

const debug = debugLib("machinen:pdeathsig");
const require_ = createRequire(import.meta.url);

/**
 * Recognize the opt-out tokens for `MACHINEN_PDEATHSIG`. Same shape
 * as `MACHINEN_GVPROXY`'s sentinels for muscle-memory consistency.
 */
function isPdeathsigDisabledSentinel(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === "disabled" || v === "off" || v === "false" || v === "0" || v === "none";
}

/**
 * Resolve the parent-death shim. Returns the absolute path to a usable
 * binary, or `null` when the user opted out, the platform is
 * unsupported, or the matching native package is not installed.
 */
export async function ensurePdeathsig(): Promise<string | null> {
  const override = process.env.MACHINEN_PDEATHSIG;
  if (override !== undefined && isPdeathsigDisabledSentinel(override)) {
    debug("opted out via MACHINEN_PDEATHSIG=%s", override);
    return null;
  }
  if (override && override.length > 0) {
    if (existsSync(override)) {
      debug("resolved via MACHINEN_PDEATHSIG=%s", override);
      return override;
    }
    debug("MACHINEN_PDEATHSIG=%s does not exist", override);
    return null;
  }

  const plat = osPlatform();
  if (plat !== "linux" && plat !== "darwin") {
    debug("unsupported platform=%s", plat);
    return null;
  }
  const bundled = findBundledPdeathsig();
  if (!bundled) {
    debug("pdeathsig binary not found in @machinen/native-%s-%s", arch(), plat);
  }
  return bundled ?? null;
}

function findBundledPdeathsig(): string | undefined {
  const pkg = `@machinen/native-${arch()}-${osPlatform()}`;
  try {
    const mod = require_(pkg) as { pdeathsig?: string };
    if (mod.pdeathsig && existsSync(mod.pdeathsig)) {
      return mod.pdeathsig;
    }
  } catch {
    // Optional dep not installed for this arch+os.
  }
  return undefined;
}

/**
 * Wrap an argv pair so the resulting spawn dies with its parent — or,
 * with `opts.watchPid`, with the given non-parent process. If
 * `pdeathsigBin` is `null` the argv is returned unchanged — caller
 * gets the unwrapped behavior (orphan-on-kill -9).
 *
 * `opts.watchPid` is for helpers whose immediate parent exits on purpose
 * while the helper should live only as long as another process (for example,
 * the VMM). Pass that watched process pid here.
 */
export function wrapWithPdeathsig(
  pdeathsigBin: string | null,
  command: string,
  args: string[],
  opts: { watchPid?: number } = {},
): { command: string; args: string[] } {
  if (!pdeathsigBin) {
    return { command, args };
  }
  if (opts.watchPid !== undefined) {
    if (!Number.isInteger(opts.watchPid) || opts.watchPid <= 0) {
      throw new Error(`wrapWithPdeathsig: invalid watchPid ${opts.watchPid}`);
    }
    return {
      command: pdeathsigBin,
      args: ["--watch-pid", String(opts.watchPid), command, ...args],
    };
  }
  return { command: pdeathsigBin, args: [command, ...args] };
}
