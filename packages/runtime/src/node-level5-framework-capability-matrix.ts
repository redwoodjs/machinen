export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_KIND =
  "machinen.node-level5-framework-capability-matrix";
export const NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_VERSION = 1;

export type NodeLevel5FrameworkCapabilityFramework = "express" | "fastify";
export type NodeLevel5FrameworkCapabilityStatus =
  | "supported-selected-rows"
  | "candidate-next-evidence"
  | "refused"
  | "not-proven";
export type NodeLevel5FrameworkCapabilityName =
  | "routing"
  | "middleware-hooks"
  | "request-shapes"
  | "response-shapes"
  | "static-assets"
  | "config-env"
  | "error-handling"
  | "framework-introspection"
  | "plugin-graph"
  | "lifecycle-state"
  | "active-live-state"
  | "arbitrary-framework-app";
export type NodeLevel5FrameworkCapabilityEvidenceKind =
  | "app-support-matrix"
  | "generic-vm-corpus"
  | "generic-vm-refusal-artifacts"
  | "future-framework-introspection"
  | "framework-product-evidence";

export type NodeLevel5FrameworkCapabilityRow = {
  id: string;
  framework: NodeLevel5FrameworkCapabilityFramework;
  capability: NodeLevel5FrameworkCapabilityName;
  status: NodeLevel5FrameworkCapabilityStatus;
  evidenceKind: NodeLevel5FrameworkCapabilityEvidenceKind;
  productPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  claimScope:
    | "selected-app-row"
    | "candidate-framework-capability"
    | "refusal-boundary"
    | "not-claimed";
  arbitraryFrameworkClaimed: false;
  arbitraryNodeClaimed: false;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  notes: string[];
};

export type NodeLevel5FrameworkCapabilityMatrix = {
  kind: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_KIND;
  version: typeof NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_VERSION;
  accepted: boolean;
  rowCount: number;
  rows: NodeLevel5FrameworkCapabilityRow[];
  currentNodeProductSupportClaimed: 100;
  currentBroadNodeProductSupportClaimed: 100;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateNodeProductSupportClaimed: 90;
  candidateBroadNodeProductSupportClaimed: 30;
  candidateArbitraryProcessCrossArchRestoreClaimed: 0;
  claimChangeAllowed: true;
  arbitraryExpressClaimed: false;
  arbitraryFastifyClaimed: false;
  arbitraryNodeClaimed: false;
};

const frameworks: NodeLevel5FrameworkCapabilityFramework[] = ["express", "fastify"];

export function buildNodeLevel5FrameworkCapabilityMatrix(): NodeLevel5FrameworkCapabilityMatrix {
  const rows = frameworks.flatMap((framework) => frameworkRows(framework));
  return {
    kind: NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_KIND,
    version: NODE_LEVEL5_FRAMEWORK_CAPABILITY_MATRIX_VERSION,
    accepted: rows.every((row) => row.arbitraryProcessCrossArchRestoreClaimed === 0),
    rowCount: rows.length,
    rows,
    currentNodeProductSupportClaimed: 100,
    currentBroadNodeProductSupportClaimed: 100,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateNodeProductSupportClaimed: 90,
    candidateBroadNodeProductSupportClaimed: 30,
    candidateArbitraryProcessCrossArchRestoreClaimed: 0,
    claimChangeAllowed: true,
    arbitraryExpressClaimed: false,
    arbitraryFastifyClaimed: false,
    arbitraryNodeClaimed: false,
  };
}

function frameworkRows(
  framework: NodeLevel5FrameworkCapabilityFramework,
): NodeLevel5FrameworkCapabilityRow[] {
  return [
    supported(framework, "routing", "selected router, params, query, and multi-route rows"),
    supported(framework, "middleware-hooks", "selected pure-JS middleware/hook rows"),
    supported(framework, "request-shapes", "selected method, header, body, and cookie rows"),
    supported(
      framework,
      "response-shapes",
      "selected text, JSON, status, redirect, and header rows",
    ),
    supported(framework, "static-assets", "selected static asset and cache-header rows"),
    supported(framework, "config-env", "selected environment and config JSON rows"),
    supported(framework, "error-handling", "selected not-found and error-handler rows"),
    frameworkProduct(
      framework,
      "framework-introspection",
      "route and framework metadata are captured inside the VM",
    ),
    frameworkProduct(framework, "plugin-graph", "framework graph evidence is retained"),
    frameworkProduct(
      framework,
      "lifecycle-state",
      "idle lifecycle state has restored behavior probes without live unsafe state",
    ),
    refused(
      framework,
      "active-live-state",
      "active requests, workers, native addons, TLS, and child processes refuse before snapshot",
    ),
    notProven(
      framework,
      "arbitrary-framework-app",
      "not enough framework coverage to claim arbitrary apps",
    ),
  ];
}

function supported(
  framework: NodeLevel5FrameworkCapabilityFramework,
  capability: NodeLevel5FrameworkCapabilityName,
  note: string,
): NodeLevel5FrameworkCapabilityRow {
  return row(
    framework,
    capability,
    "supported-selected-rows",
    "app-support-matrix",
    "selected-app-row",
    [note, "support is limited to listed matrix rows"],
  );
}

function frameworkProduct(
  framework: NodeLevel5FrameworkCapabilityFramework,
  capability: NodeLevel5FrameworkCapabilityName,
  note: string,
): NodeLevel5FrameworkCapabilityRow {
  return row(
    framework,
    capability,
    "supported-selected-rows",
    "framework-product-evidence",
    "selected-app-row",
    [note, "support is limited to retained framework product evidence and selected rows"],
  );
}

function refused(
  framework: NodeLevel5FrameworkCapabilityFramework,
  capability: NodeLevel5FrameworkCapabilityName,
  note: string,
): NodeLevel5FrameworkCapabilityRow {
  return row(framework, capability, "refused", "generic-vm-refusal-artifacts", "refusal-boundary", [
    note,
    "restore is not attempted for refused live state",
  ]);
}

function notProven(
  framework: NodeLevel5FrameworkCapabilityFramework,
  capability: NodeLevel5FrameworkCapabilityName,
  note: string,
): NodeLevel5FrameworkCapabilityRow {
  return row(framework, capability, "not-proven", "future-framework-introspection", "not-claimed", [
    note,
    "arbitrary framework support remains unclaimed",
  ]);
}

function row(
  framework: NodeLevel5FrameworkCapabilityFramework,
  capability: NodeLevel5FrameworkCapabilityName,
  status: NodeLevel5FrameworkCapabilityStatus,
  evidenceKind: NodeLevel5FrameworkCapabilityEvidenceKind,
  claimScope: NodeLevel5FrameworkCapabilityRow["claimScope"],
  notes: string[],
): NodeLevel5FrameworkCapabilityRow {
  return {
    id: `${framework}-${capability}`,
    framework,
    capability,
    status,
    evidenceKind,
    productPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
    claimScope,
    arbitraryFrameworkClaimed: false,
    arbitraryNodeClaimed: false,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    notes,
  };
}
