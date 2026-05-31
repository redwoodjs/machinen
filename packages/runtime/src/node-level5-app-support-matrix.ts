export const NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND = "machinen.node-level5-app-support-matrix";
export const NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION = 1;

export type NodeLevel5AppSupportStatus = "supported" | "refused";
export type NodeLevel5AppSupportFramework = "express" | "fastify";
export type NodeLevel5AppSupportEvidenceKind =
  | "fixture-product-run-corpus"
  | "template-corpus"
  | "installed-package-corpus"
  | "refusal-corpus";
export type NodeLevel5AppSupportProductBehavior =
  | "machinen snapshot node <pid> --out <dir>; machinen restore <dir>"
  | "refuse-before-snapshot";
export type NodeLevel5AppSupportDirection = "arm64-to-amd64" | "amd64-to-arm64";

export type NodeLevel5AppSupportEvidence = {
  kind: NodeLevel5AppSupportEvidenceKind;
  proofRange: string;
  corpusReport: string;
};

export type NodeLevel5AppSupportMatrixRow = {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  status: NodeLevel5AppSupportStatus;
  productBehavior: NodeLevel5AppSupportProductBehavior;
  supportScope: "declared-subset-idle-http" | "unsupported-live-state";
  directions: NodeLevel5AppSupportDirection[];
  evidence: NodeLevel5AppSupportEvidence;
  supportedAppShape: string;
  limitations: string[];
};

export type NodeLevel5AppSupportBoundary = {
  id: string;
  status: "not-claimed" | "out-of-scope";
  reason: string;
};

export type NodeLevel5AppSupportMatrix = {
  kind: typeof NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND;
  version: typeof NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION;
  accepted: boolean;
  rowCount: number;
  rows: NodeLevel5AppSupportMatrixRow[];
  boundaries: NodeLevel5AppSupportBoundary[];
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const directions: NodeLevel5AppSupportDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];

export function buildNodeLevel5AppSupportMatrix(): NodeLevel5AppSupportMatrix {
  const rows = [...fixtureRows(), ...templateRows(), ...installedRows(), ...refusalRows()];
  return {
    kind: NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND,
    version: NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION,
    accepted: rows.every(isAcceptedAppSupportRow),
    rowCount: rows.length,
    rows,
    boundaries: supportBoundaries(),
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function supportedNodeLevel5AppSupportRows(): NodeLevel5AppSupportMatrixRow[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "supported");
}

export function refusedNodeLevel5AppSupportRows(): NodeLevel5AppSupportMatrixRow[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "refused");
}

function fixtureRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    supportedRow({
      id: "express-fixture-product-run",
      appName: "Express fixture product-run app",
      framework: "express",
      evidence: productRunEvidence(),
      supportedAppShape: "idle HTTP server with retained route/body/header verifier",
      limitations: fixtureLimitations(),
    }),
    supportedRow({
      id: "fastify-fixture-product-run",
      appName: "Fastify fixture product-run app",
      framework: "fastify",
      evidence: productRunEvidence(),
      supportedAppShape: "idle HTTP server with retained route/body/header verifier",
      limitations: fixtureLimitations(),
    }),
  ];
}

function templateRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    templateRow("express-official-hello-world", "Express official hello-world template", "express"),
    templateRow("express-generator-router", "Express generator router template", "express"),
    templateRow("fastify-official-getting-started", "Fastify getting-started template", "fastify"),
    templateRow("fastify-plugin-route", "Fastify plugin-route template", "fastify"),
  ];
}

function installedRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    installedRow("express-installed-hello-world", "Installed Express hello-world app", "express"),
    installedRow("express-installed-router", "Installed Express router app", "express"),
    installedRow(
      "fastify-installed-getting-started",
      "Installed Fastify getting-started app",
      "fastify",
    ),
    installedRow("fastify-installed-plugin-route", "Installed Fastify plugin-route app", "fastify"),
  ];
}

function refusalRows(): NodeLevel5AppSupportMatrixRow[] {
  return refusalMarkers().flatMap((marker) => [
    refusalRow("express", marker),
    refusalRow("fastify", marker),
  ]);
}

function templateRow(
  id: string,
  appName: string,
  framework: NodeLevel5AppSupportFramework,
): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    id,
    appName,
    framework,
    evidence: {
      kind: "template-corpus",
      proofRange: "801-840",
      corpusReport: "node-level5-third-party-app-corpus-report.json",
    },
    supportedAppShape: "declared-subset app-template idle HTTP route",
    limitations: ["template-shaped proof app", ...commonPositiveLimitations()],
  });
}

function installedRow(
  id: string,
  appName: string,
  framework: NodeLevel5AppSupportFramework,
): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    id,
    appName,
    framework,
    evidence: {
      kind: "installed-package-corpus",
      proofRange: "841-880",
      corpusReport: "node-level5-installed-third-party-app-corpus-report.json",
    },
    supportedAppShape: "selected installed package idle HTTP app",
    limitations: ["selected installed package example only", ...commonPositiveLimitations()],
  });
}

function supportedRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  evidence: NodeLevel5AppSupportEvidence;
  supportedAppShape: string;
  limitations: string[];
}): NodeLevel5AppSupportMatrixRow {
  return {
    id: input.id,
    appName: input.appName,
    framework: input.framework,
    status: "supported",
    productBehavior: "machinen snapshot node <pid> --out <dir>; machinen restore <dir>",
    supportScope: "declared-subset-idle-http",
    directions,
    evidence: input.evidence,
    supportedAppShape: input.supportedAppShape,
    limitations: input.limitations,
  };
}

function refusalRow(
  framework: NodeLevel5AppSupportFramework,
  marker: { id: string; appName: string; reason: string },
): NodeLevel5AppSupportMatrixRow {
  return {
    id: `${framework}-${marker.id}`,
    appName: `${framework} ${marker.appName}`,
    framework,
    status: "refused",
    productBehavior: "refuse-before-snapshot",
    supportScope: "unsupported-live-state",
    directions,
    evidence: {
      kind: "refusal-corpus",
      proofRange: "761-800",
      corpusReport: "node-level5-real-app-refusal-corpus-report.json",
    },
    supportedAppShape: marker.reason,
    limitations: ["snapshot must be refused before manifest write", "restore is not attempted"],
  };
}

function productRunEvidence(): NodeLevel5AppSupportEvidence {
  return {
    kind: "fixture-product-run-corpus",
    proofRange: "721-760",
    corpusReport: "node-level5-real-app-corpus-report.json",
  };
}

function fixtureLimitations(): string[] {
  return ["fixture app only", ...commonPositiveLimitations()];
}

function commonPositiveLimitations(): string[] {
  return [
    "idle HTTP server state only",
    "no active requests",
    "no websockets",
    "no TLS live state",
    "no workers",
    "no child processes",
    "no native addons",
    "no filesystem watchers",
    "no Wasm/external memory",
  ];
}

function refusalMarkers(): Array<{ id: string; appName: string; reason: string }> {
  return [
    {
      id: "active-requests",
      appName: "active request app",
      reason: "active in-flight HTTP request",
    },
    { id: "worker-threads", appName: "worker thread app", reason: "worker thread state" },
    { id: "native-addons", appName: "native addon app", reason: "native addon state" },
    {
      id: "wasm-external-memory",
      appName: "Wasm external memory app",
      reason: "Wasm or external memory state",
    },
    { id: "tls-active-state", appName: "TLS active state app", reason: "active TLS session state" },
    { id: "child-processes", appName: "child process app", reason: "live child process state" },
    {
      id: "filesystem-watchers",
      appName: "filesystem watcher app",
      reason: "filesystem watcher state",
    },
    { id: "websockets", appName: "websocket app", reason: "live websocket state" },
  ];
}

function supportBoundaries(): NodeLevel5AppSupportBoundary[] {
  return [
    {
      id: "arbitrary-express-app",
      status: "not-claimed",
      reason: "only listed Express fixture/template/installed app rows are supported today",
    },
    {
      id: "arbitrary-fastify-app",
      status: "not-claimed",
      reason: "only listed Fastify fixture/template/installed app rows are supported today",
    },
    {
      id: "arbitrary-node-process",
      status: "not-claimed",
      reason: "broad Node state translation is not proven by the app corpus",
    },
    {
      id: "raw-cross-arch-cpu-restore",
      status: "out-of-scope",
      reason: "Node Level 5 uses translated continuation, not copied CPU/register state",
    },
  ];
}

function isAcceptedAppSupportRow(row: NodeLevel5AppSupportMatrixRow): boolean {
  return (
    directions.every((direction) => row.directions.includes(direction)) &&
    row.evidence.proofRange.length > 0 &&
    row.evidence.corpusReport.endsWith(".json") &&
    row.limitations.length > 0
  );
}
