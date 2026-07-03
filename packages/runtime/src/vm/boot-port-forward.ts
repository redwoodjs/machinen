import { BootError } from "../errors.ts";
import { describePortHolder, probeHostPortFree } from "../gvproxy.ts";
import {
  planPortForwardProbeNative,
  validatePortForwardNetSocketNative,
} from "../native/port-forward.ts";
import type { BootOptions } from "./boot.ts";

// Validate portForward up front — before resolving the binary or
// touching the filesystem — so caller-input errors surface with a
// clear message. The env-dependent "pre-set MACHINEN_NET_SOCKET"
// check happens alongside since it only reads env.
export async function planPortForwardOpts(
  opts: BootOptions,
): Promise<NonNullable<BootOptions["portForward"]>> {
  const portForward = opts.portForward ?? [];
  if (portForward.length === 0) {
    return [];
  }
  validatePortForwardMappings(portForward);
  validatePresetNetSocket(opts, portForward);
  await validatePortForwardAvailability(portForward);
  return portForward;
}

function validatePresetNetSocket(
  opts: BootOptions,
  portForward: NonNullable<BootOptions["portForward"]>,
): void {
  validatePortForwardNetSocketNative(
    portForward,
    (opts.vmmEnv && opts.vmmEnv.MACHINEN_NET_SOCKET) || process.env.MACHINEN_NET_SOCKET,
  );
}

async function validatePortForwardAvailability(
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<void> {
  for (const probe of planPortForwardProbeNative(portForward)) {
    await validateHostPortFree(probe);
  }
}

async function validateHostPortFree(probe: { hostPort: number; probeHost: string }): Promise<void> {
  const errno = await probeHostPortFree(probe.probeHost, probe.hostPort);
  if (!errno) {
    return;
  }
  throw new BootError(
    "BOOT_PORT_FORWARD_IN_USE",
    `portForward: host port ${probe.probeHost}:${probe.hostPort} is already in use (${errno}). ${await portHolderDetail(probe.hostPort)}`,
  );
}

async function portHolderDetail(hostPort: number): Promise<string> {
  const holder = await describePortHolder(hostPort).catch(() => null);
  return holder
    ? `${holder}.`
    : "Common cause: an orphaned gvproxy from a prior `kill -9` of the VMM. " +
        "Try `pkill -f gvproxy` to clear it, or pick a different host port.";
}

function validatePortForwardMappings(portForward: NonNullable<BootOptions["portForward"]>): void {
  const seen = new Set<number>();
  for (const mapping of portForward) {
    validatePortMapping(mapping);
    validateUniqueHostPort(seen, mapping.hostPort);
  }
}

function validatePortMapping(mapping: { hostPort: number; guestPort: number }): void {
  validateTcpPort(mapping.hostPort, "hostPort");
  validateTcpPort(mapping.guestPort, "guestPort");
}

function validateTcpPort(port: number, label: "hostPort" | "guestPort"): void {
  if (validTcpPort(port)) {
    return;
  }
  throw new BootError(
    "BOOT_PORT_FORWARD_INVALID",
    `portForward: ${label} must be an integer in 1..65535 (got ${port})`,
  );
}

function validateUniqueHostPort(seen: Set<number>, hostPort: number): void {
  if (seen.has(hostPort)) {
    throw new BootError(
      "BOOT_PORT_FORWARD_CONFLICT",
      `portForward: duplicate hostPort ${hostPort}`,
    );
  }
  seen.add(hostPort);
}

function validTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}
