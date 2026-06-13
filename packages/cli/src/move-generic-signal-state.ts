import type { MoveDescriptor } from "@machinen/runtime";

import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type GenericState = NonNullable<MoveResourcePlan["capture"]>["genericResourceGraphState"];
type GenericResourceClass = NonNullable<GenericState>["resourceClasses"][number];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];
type GenericResource = MoveResourcePlan["resources"][number];

export function genericSignalState(
  preflight: GenericPreflight,
): NonNullable<GenericState>["signalState"] | undefined {
  if (!preflight.signal) {
    return undefined;
  }
  return {
    ...preflight.signal,
    dispositionPolicy: "recorded-default-ignored-caught-masks",
    pendingPolicy: "refuse-nonzero-pending",
    processGroupPolicy: signalProcessGroupPolicy(preflight),
    support: "refused-baseline",
  };
}

export function genericSignalfds(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): NonNullable<GenericState>["signalfds"] {
  return resourcePlan.resources
    .filter((resource) => resource.kind === "signalfd" && resource.fd !== undefined)
    .map((resource) => {
      const signalfd = preflight.signalfds.find((item) => item.fd === resource.fd);
      return {
        fd: resource.fd!,
        path: "anon_inode:[signalfd]" as const,
        fdinfoFlags: signalfd?.fdinfoFlags ?? stringRecipeValue(resource, "fdinfoFlags"),
        flags: resource.flags ?? [],
        sigmask: signalfdMask(preflight, signalfd, resource),
        support: "refused-baseline" as const,
      };
    });
}

export function genericSignalResourceClasses(
  preflight: GenericPreflight,
  resourcePlan: MoveResourcePlan,
): GenericResourceClass[] {
  const classes: GenericResourceClass[] = [];
  const signalfds = genericSignalfds(preflight, resourcePlan);
  if (signalfds.length > 0) {
    classes.push({
      resourceClass: "signalMaskDispositionEvidence",
      status: "unknown",
      evidence: signalEvidence(preflight),
    });
    classes.push({
      resourceClass: "signalfdBaseline",
      status: "refused",
      evidence: `signalfd masks recorded for fds=${signalfds.map((item) => item.fd).join(",")}`,
    });
  }
  return classes;
}

export function genericSignalStateRefusals(preflight: GenericPreflight): GenericRefusalClass[] {
  if (!preflight.signal || !hasPendingSignal(preflight.signal)) {
    return [];
  }
  return [
    {
      resourceClass: "pendingSignalState",
      status: "refused",
      reason: "pending signal delivery is not generically replayed",
      evidence: signalEvidence(preflight),
      nextAction: "drain pending signals or add an explicit signal delivery reconstruction model",
    },
  ];
}

function signalfdMask(
  preflight: GenericPreflight,
  signalfd: GenericPreflight["signalfds"][number] | undefined,
  resource: GenericResource,
): string {
  const mask = signalfd?.sigmask ?? stringRecipeValue(resource, "signalfdSigmask");
  return mask && mask !== "0" && mask !== "unknown"
    ? mask
    : (preflight.signal?.blockedMaskHex ?? "unknown");
}

function signalProcessGroupPolicy(
  preflight: GenericPreflight,
): "single-process-group" | "refused-ambiguous-process-group" {
  const signal = preflight.signal;
  return signal?.processGroupId !== undefined && signal.processGroupId !== 0
    ? "single-process-group"
    : "refused-ambiguous-process-group";
}

function hasPendingSignal(signal: NonNullable<GenericPreflight["signal"]>): boolean {
  return maskIsNonzero(signal.pendingMaskHex) || maskIsNonzero(signal.sharedPendingMaskHex);
}

function maskIsNonzero(mask: string): boolean {
  return /^[0-9a-fA-F]+$/.test(mask) && BigInt(`0x${mask}`) !== 0n;
}

function signalEvidence(preflight: GenericPreflight): string {
  const signal = preflight.signal;
  return signal
    ? `sid=${signal.sessionId ?? "unknown"} pgrp=${signal.processGroupId ?? "unknown"} pending=${signal.pendingMaskHex} sharedPending=${signal.sharedPendingMaskHex} blocked=${signal.blockedMaskHex} ignored=${signal.ignoredMaskHex} caught=${signal.caughtMaskHex}`
    : "signal status unavailable";
}

function stringRecipeValue(resource: GenericResource, key: string): string | undefined {
  const value = resource.recipe?.[key];
  return typeof value === "string" ? value : undefined;
}
