// Provider selection. Pure resolution, no spawning, so it can run before
// any Linux asset work in `boot()` and can be unit-tested without a host.

import { platform as osPlatform, arch as osArch } from "node:os";

import { BootError } from "../errors.ts";
import { GUEST_OS_VALUES, PROVIDER_VALUES, type GuestOS, type ProviderId } from "./types.ts";

export interface ProviderSelection {
  guestOS: GuestOS;
  provider: ProviderId;
}

/**
 * Resolve the guest OS. Absent means `linux`, which is what every caller
 * and every pre-existing registry entry means today.
 */
export function resolveGuestOS(value: string | undefined): GuestOS {
  if (value === undefined || value === "") {
    return "linux";
  }
  if ((GUEST_OS_VALUES as readonly string[]).includes(value)) {
    return value as GuestOS;
  }
  throw new BootError(
    "PROVIDER_UNSUPPORTED_OPERATION",
    `unknown guest OS ${JSON.stringify(value)}. Allowed values are ${GUEST_OS_VALUES.join(", ")}.`,
  );
}

/**
 * Resolve the provider. When the caller names one, it wins. Otherwise the
 * provider follows from the guest OS and the host, which keeps Linux
 * selection exactly as it was before this module existed.
 */
export function resolveProviderId(guestOS: GuestOS, value: string | undefined): ProviderId {
  if (value !== undefined && value !== "") {
    if (!(PROVIDER_VALUES as readonly string[]).includes(value)) {
      throw new BootError(
        "PROVIDER_UNSUPPORTED_OPERATION",
        `unknown provider ${JSON.stringify(value)}. Allowed values are ${PROVIDER_VALUES.join(", ")}.`,
      );
    }
    return value as ProviderId;
  }
  if (guestOS === "macos") {
    return "apple-vz";
  }
  return osPlatform() === "darwin" ? "machinen-hvf" : "machinen-kvm";
}

export function selectProvider(opts: { guestOS?: string; provider?: string }): ProviderSelection {
  const guestOS = resolveGuestOS(opts.guestOS);
  return { guestOS, provider: resolveProviderId(guestOS, opts.provider) };
}

export function isLinuxProvider(selection: ProviderSelection): boolean {
  return selection.guestOS === "linux";
}

/**
 * macOS guests run only on Apple silicon. Checked before any spawn so the
 * failure names the host rather than surfacing later as a missing binary.
 */
export function assertProviderHostSupported(selection: ProviderSelection): void {
  if (selection.guestOS !== "macos") {
    return;
  }
  if (osPlatform() !== "darwin") {
    throw new BootError(
      "PROVIDER_HOST_UNSUPPORTED",
      `guestOS "macos" requires a Darwin host, but this host is ${osPlatform()}.`,
    );
  }
  if (osArch() !== "arm64") {
    throw new BootError(
      "PROVIDER_HOST_UNSUPPORTED",
      `guestOS "macos" requires an arm64 host, but this host is ${osArch()}.`,
    );
  }
}
