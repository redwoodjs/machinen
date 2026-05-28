import { arch as osArch, platform as osPlatform } from "node:os";

export const OPPOSITE_ISA_VM_EXECUTION_KIND =
  "machinen.cross-arch-criu.opposite-isa-vm-execution" as const;

export const oppositeIsaVmExecutionRefusalCodes = [
  "opposite-isa-provider-unavailable",
  "opposite-isa-assets-missing",
  "opposite-isa-not-opposite-route",
  "opposite-isa-boot-failed",
  "opposite-isa-guest-uname-mismatch",
  "opposite-isa-guest-elf-mismatch",
  "opposite-isa-verifier-incomplete",
  "opposite-isa-host-sidecar-output",
] as const;

export type OppositeIsaVmExecutionRefusalCode = (typeof oppositeIsaVmExecutionRefusalCodes)[number];
export type OppositeIsaVmExecutionArch = "arm64" | "amd64" | "unknown";
export type OppositeIsaVmExecutionState = "completed" | "refused" | "skipped";

export interface OppositeIsaVmExecutionProviderRoute {
  hostArch: OppositeIsaVmExecutionArch;
  guestArch: OppositeIsaVmExecutionArch;
  providerMode: string;
  accelerated: boolean;
  emulated: boolean;
  available: boolean;
  unavailableReason?: OppositeIsaVmExecutionRefusalCode;
  remediation?: string;
}

export interface OppositeIsaVmExecutionEvidence {
  hostArch: OppositeIsaVmExecutionArch;
  guestArch: OppositeIsaVmExecutionArch;
  providerMode: string;
  accelerated: boolean;
  emulated: boolean;
  kernelVersion?: string | null;
  rootfsDigest?: string | null;
  guestUnameMachine?: string | null;
  guestElfMachine?: string | null;
  verifierOutput?: string | null;
  verifierSource: "guest-exec" | "host-sidecar" | "unknown";
  routeAvailable?: boolean;
  unavailableReason?: OppositeIsaVmExecutionRefusalCode;
  remediation?: string;
}

export interface OppositeIsaVmExecutionSummary {
  kind: typeof OPPOSITE_ISA_VM_EXECUTION_KIND;
  hostArch: OppositeIsaVmExecutionArch;
  guestArch: OppositeIsaVmExecutionArch;
  providerMode: string;
  accelerated: boolean;
  emulated: boolean;
  kernelVersion: string | null;
  rootfsDigest: string | null;
  guestUnameMachine: string | null;
  guestElfMachine: string | null;
  verifierOutput: string;
  state: OppositeIsaVmExecutionState;
  refusalCode?: OppositeIsaVmExecutionRefusalCode;
  remediation?: string;
}

const PROVIDER_REMEDIATION =
  "Run this proof on a host/provider that can boot the requested guest ISA, or add an explicit emulation/provider mode before claiming this route.";

export function hostArchitectureFromNode(arch = osArch()): OppositeIsaVmExecutionArch {
  if (arch === "arm64" || arch === "aarch64") {
    return "arm64";
  }
  if (arch === "x64" || arch === "amd64" || arch === "x86_64") {
    return "amd64";
  }
  return "unknown";
}

export function oppositeGuestArchitecture(
  hostArch: OppositeIsaVmExecutionArch,
): OppositeIsaVmExecutionArch {
  if (hostArch === "arm64") {
    return "amd64";
  }
  if (hostArch === "amd64") {
    return "arm64";
  }
  return "unknown";
}

export function normalizeGuestMachine(
  value: string | null | undefined,
): OppositeIsaVmExecutionArch {
  const text = (value ?? "").toLowerCase();
  if (text.includes("aarch64") || text.includes("arm64")) {
    return "arm64";
  }
  if (text.includes("x86_64") || text.includes("x86-64") || text.includes("amd64")) {
    return "amd64";
  }
  return "unknown";
}

// fallow-ignore-next-line complexity
export function classifyOppositeIsaProviderRoute(input: {
  hostArch?: OppositeIsaVmExecutionArch;
  guestArch: OppositeIsaVmExecutionArch;
  platform?: NodeJS.Platform;
  hasKvm?: boolean;
  emulationAvailable?: boolean;
}): OppositeIsaVmExecutionProviderRoute {
  const hostArch = input.hostArch ?? hostArchitectureFromNode();
  const platform = input.platform ?? osPlatform();
  const sameIsa = hostArch === input.guestArch && hostArch !== "unknown";
  if (input.emulationAvailable && !sameIsa) {
    return {
      hostArch,
      guestArch: input.guestArch,
      providerMode: `${platform}-explicit-emulation`,
      accelerated: false,
      emulated: true,
      available: true,
    };
  }
  if (platform === "darwin") {
    return {
      hostArch,
      guestArch: input.guestArch,
      providerMode: sameIsa ? "darwin-hvf-native" : "darwin-hvf-opposite-isa-unsupported",
      accelerated: sameIsa,
      emulated: false,
      available: sameIsa,
      unavailableReason: sameIsa ? undefined : "opposite-isa-provider-unavailable",
      remediation: sameIsa ? undefined : PROVIDER_REMEDIATION,
    };
  }
  if (platform === "linux") {
    const kvm = input.hasKvm === true;
    return {
      hostArch,
      guestArch: input.guestArch,
      providerMode: sameIsa && kvm ? "linux-kvm-native" : "linux-kvm-opposite-isa-unsupported",
      accelerated: sameIsa && kvm,
      emulated: false,
      available: sameIsa && kvm,
      unavailableReason: sameIsa && kvm ? undefined : "opposite-isa-provider-unavailable",
      remediation: sameIsa && kvm ? undefined : PROVIDER_REMEDIATION,
    };
  }
  return {
    hostArch,
    guestArch: input.guestArch,
    providerMode: `${platform}-provider-unknown`,
    accelerated: false,
    emulated: false,
    available: false,
    unavailableReason: "opposite-isa-provider-unavailable",
    remediation: PROVIDER_REMEDIATION,
  };
}

export function buildOppositeIsaVmExecutionSummary(
  evidence: OppositeIsaVmExecutionEvidence,
): OppositeIsaVmExecutionSummary {
  const base = summaryBase(evidence);
  const refusal = classifyRefusal(evidence);
  if (refusal) {
    return {
      ...base,
      state: refusal.state,
      refusalCode: refusal.code,
      remediation: refusal.remediation,
    };
  }
  return { ...base, state: "completed" };
}

function summaryBase(
  evidence: OppositeIsaVmExecutionEvidence,
): Omit<OppositeIsaVmExecutionSummary, "state" | "refusalCode" | "remediation"> {
  return {
    kind: OPPOSITE_ISA_VM_EXECUTION_KIND,
    hostArch: evidence.hostArch,
    guestArch: evidence.guestArch,
    providerMode: evidence.providerMode,
    accelerated: evidence.accelerated,
    emulated: evidence.emulated,
    kernelVersion: evidence.kernelVersion ?? null,
    rootfsDigest: evidence.rootfsDigest ?? null,
    guestUnameMachine: evidence.guestUnameMachine ?? null,
    guestElfMachine: evidence.guestElfMachine ?? null,
    verifierOutput: evidence.verifierOutput ?? "",
  };
}

// fallow-ignore-next-line complexity
function classifyRefusal(evidence: OppositeIsaVmExecutionEvidence):
  | {
      state: "refused" | "skipped";
      code: OppositeIsaVmExecutionRefusalCode;
      remediation: string;
    }
  | undefined {
  if (evidence.hostArch === evidence.guestArch) {
    return {
      state: "skipped",
      code: "opposite-isa-not-opposite-route",
      remediation: "Choose a guest architecture different from the host architecture.",
    };
  }
  if (evidence.routeAvailable === false) {
    return {
      state: "skipped",
      code: evidence.unavailableReason ?? "opposite-isa-provider-unavailable",
      remediation: evidence.remediation ?? PROVIDER_REMEDIATION,
    };
  }
  if (!evidence.rootfsDigest) {
    return {
      state: "skipped",
      code: "opposite-isa-assets-missing",
      remediation:
        "Provide the guest rootfs/kernel assets with MACHINEN_ASSETS_DIR or populate the Machinen asset cache.",
    };
  }
  if (evidence.verifierSource === "host-sidecar") {
    return {
      state: "refused",
      code: "opposite-isa-host-sidecar-output",
      remediation:
        "Run uname and the ELF verifier through guest exec; host-sidecar output is not proof.",
    };
  }
  if (!evidence.guestUnameMachine || !evidence.guestElfMachine || !evidence.verifierOutput) {
    return {
      state: "refused",
      code: "opposite-isa-verifier-incomplete",
      remediation:
        "Collect guest uname, guest ELF machine, and verifier output from inside the VM.",
    };
  }
  if (normalizeGuestMachine(evidence.guestUnameMachine) !== evidence.guestArch) {
    return {
      state: "refused",
      code: "opposite-isa-guest-uname-mismatch",
      remediation: "The guest uname -m output must match the requested guest architecture.",
    };
  }
  if (normalizeGuestMachine(evidence.guestElfMachine) !== evidence.guestArch) {
    return {
      state: "refused",
      code: "opposite-isa-guest-elf-mismatch",
      remediation: "The executed ELF machine type must match the requested guest architecture.",
    };
  }
  if (evidence.verifierSource !== "guest-exec") {
    return {
      state: "refused",
      code: "opposite-isa-verifier-incomplete",
      remediation: "The verifier must identify guest exec as its source.",
    };
  }
  return undefined;
}
