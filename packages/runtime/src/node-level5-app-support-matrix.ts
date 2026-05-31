export const NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND = "machinen.node-level5-app-support-matrix";
export const NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION = 2;

export type NodeLevel5AppSupportStatus = "supported" | "refused" | "not-proven";
export type NodeLevel5AppSupportFramework = "express" | "fastify";
export type NodeLevel5AppSupportEvidenceKind =
  | "fixture-product-run-corpus"
  | "template-corpus"
  | "installed-package-corpus"
  | "refusal-corpus"
  | "matrix-gap";
export type NodeLevel5AppSupportProductBehavior =
  | "machinen snapshot node <pid> --out <dir>; machinen restore <dir>"
  | "refuse-before-snapshot"
  | "not-proven";
export type NodeLevel5AppSupportDirection = "arm64-to-amd64" | "amd64-to-arm64";
export type NodeLevel5AppSupportRouteFeature =
  | "simple-route"
  | "router-route"
  | "plugin-route"
  | "unsupported-live-state"
  | "not-proven";
export type NodeLevel5AppSupportResponseFeature = "text" | "json" | "not-proven";
export type NodeLevel5AppSupportMiddlewareFeature = "none" | "pure-js" | "not-proven";
export type NodeLevel5AppSupportFeatureName =
  | "route"
  | "response"
  | "middleware"
  | "asyncHandler"
  | "params"
  | "query"
  | "staticAssets"
  | "externalNetwork"
  | "backgroundTasks";
export type NodeLevel5AppSupportFeatureStatus = "supported" | "refused" | "not-proven";

export type NodeLevel5AppSupportFeatures = {
  route: NodeLevel5AppSupportRouteFeature;
  response: NodeLevel5AppSupportResponseFeature;
  middleware: NodeLevel5AppSupportMiddlewareFeature;
  asyncHandler: boolean;
  params: boolean;
  query: boolean;
  staticAssets: boolean;
  externalNetwork: boolean;
  backgroundTasks: boolean;
};

export type NodeLevel5AppSupportFeatureAssessment = Record<
  NodeLevel5AppSupportFeatureName,
  NodeLevel5AppSupportFeatureStatus
>;

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
  supportScope: "declared-subset-idle-http" | "unsupported-live-state" | "not-proven-gap";
  directions: NodeLevel5AppSupportDirection[];
  evidence: NodeLevel5AppSupportEvidence;
  supportedAppShape: string;
  features: NodeLevel5AppSupportFeatures;
  featureAssessment: NodeLevel5AppSupportFeatureAssessment;
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

type SupportedRowInput = {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  evidence: NodeLevel5AppSupportEvidence;
  supportedAppShape: string;
  features: NodeLevel5AppSupportFeatures;
  limitations: string[];
};

type RefusalMarker = {
  id: string;
  appName: string;
  reason: string;
  feature: NodeLevel5AppSupportFeatureName;
};

const directions: NodeLevel5AppSupportDirection[] = ["arm64-to-amd64", "amd64-to-arm64"];

export function buildNodeLevel5AppSupportMatrix(): NodeLevel5AppSupportMatrix {
  const rows = [
    ...fixtureRows(),
    ...templateRows(),
    ...installedRows(),
    ...refusalRows(),
    ...notProvenRows(),
  ];
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

export function notProvenNodeLevel5AppSupportRows(): NodeLevel5AppSupportMatrixRow[] {
  return buildNodeLevel5AppSupportMatrix().rows.filter((row) => row.status === "not-proven");
}

function fixtureRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    supportedRow({
      id: "express-fixture-product-run",
      appName: "Express fixture product-run app",
      framework: "express",
      evidence: productRunEvidence(),
      supportedAppShape: "idle HTTP server with retained route/body/header verifier",
      features: simpleTextFeatures(),
      limitations: fixtureLimitations(),
    }),
    supportedRow({
      id: "fastify-fixture-product-run",
      appName: "Fastify fixture product-run app",
      framework: "fastify",
      evidence: productRunEvidence(),
      supportedAppShape: "idle HTTP server with retained route/body/header verifier",
      features: simpleTextFeatures(),
      limitations: fixtureLimitations(),
    }),
  ];
}

function templateRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    templateRow({
      id: "express-official-hello-world",
      appName: "Express official hello-world template",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    templateRow({
      id: "express-generator-router",
      appName: "Express generator router template",
      framework: "express",
      features: routerTextFeatures(),
    }),
    templateRow({
      id: "fastify-official-getting-started",
      appName: "Fastify getting-started template",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    templateRow({
      id: "fastify-plugin-route",
      appName: "Fastify plugin-route template",
      framework: "fastify",
      features: asyncTextFeatures("plugin-route", "pure-js"),
    }),
  ];
}

function installedRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    installedRow({
      id: "express-installed-hello-world",
      appName: "Installed Express hello-world app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedRow({
      id: "express-installed-router",
      appName: "Installed Express router app",
      framework: "express",
      features: routerTextFeatures(),
    }),
    installedRow({
      id: "fastify-installed-getting-started",
      appName: "Installed Fastify getting-started app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedRow({
      id: "fastify-installed-plugin-route",
      appName: "Installed Fastify plugin-route app",
      framework: "fastify",
      features: asyncTextFeatures("plugin-route", "pure-js"),
    }),
  ];
}

function refusalRows(): NodeLevel5AppSupportMatrixRow[] {
  return refusalMarkers().flatMap((marker) => [
    refusalRow("express", marker),
    refusalRow("fastify", marker),
  ]);
}

function notProvenRows(): NodeLevel5AppSupportMatrixRow[] {
  return notProvenFeatureRows().flatMap((feature) => [
    notProvenRow("express", feature),
    notProvenRow("fastify", feature),
  ]);
}

function templateRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    ...input,
    evidence: {
      kind: "template-corpus",
      proofRange: "801-840",
      corpusReport: "node-level5-third-party-app-corpus-report.json",
    },
    supportedAppShape: "declared-subset app-template idle HTTP route",
    limitations: ["template-shaped proof app", ...commonPositiveLimitations()],
  });
}

function installedRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    ...input,
    evidence: {
      kind: "installed-package-corpus",
      proofRange: "841-880",
      corpusReport: "node-level5-installed-third-party-app-corpus-report.json",
    },
    supportedAppShape: "selected installed package idle HTTP app",
    limitations: ["selected installed package example only", ...commonPositiveLimitations()],
  });
}

function supportedRow(input: SupportedRowInput): NodeLevel5AppSupportMatrixRow {
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
    features: input.features,
    featureAssessment: supportedFeatureAssessment(input.features),
    limitations: input.limitations,
  };
}

function refusalRow(
  framework: NodeLevel5AppSupportFramework,
  marker: RefusalMarker,
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
    features: unsupportedLiveStateFeatures(marker.feature),
    featureAssessment: refusedFeatureAssessment(marker.feature),
    limitations: ["snapshot must be refused before manifest write", "restore is not attempted"],
  };
}

function notProvenRow(
  framework: NodeLevel5AppSupportFramework,
  feature: { id: string; name: NodeLevel5AppSupportFeatureName; reason: string },
): NodeLevel5AppSupportMatrixRow {
  return {
    id: `${framework}-${feature.id}-not-proven`,
    appName: `${framework} ${feature.id} app gap`,
    framework,
    status: "not-proven",
    productBehavior: "not-proven",
    supportScope: "not-proven-gap",
    directions,
    evidence: { kind: "matrix-gap", proofRange: "921-960", corpusReport: "none-yet" },
    supportedAppShape: feature.reason,
    features: notProvenFeatures(feature.name),
    featureAssessment: notProvenFeatureAssessment(feature.name),
    limitations: ["no product corpus row yet", "not a support claim"],
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
    "feature support is limited to rows whose featureAssessment marks the feature supported",
  ];
}

function simpleTextFeatures(): NodeLevel5AppSupportFeatures {
  return baseFeatures({ route: "simple-route", response: "text", middleware: "none" });
}

function routerTextFeatures(): NodeLevel5AppSupportFeatures {
  return baseFeatures({ route: "router-route", response: "text", middleware: "pure-js" });
}

function asyncTextFeatures(
  route: NodeLevel5AppSupportRouteFeature,
  middleware: NodeLevel5AppSupportMiddlewareFeature,
): NodeLevel5AppSupportFeatures {
  return { ...baseFeatures({ route, response: "text", middleware }), asyncHandler: true };
}

function baseFeatures(input: {
  route: NodeLevel5AppSupportRouteFeature;
  response: NodeLevel5AppSupportResponseFeature;
  middleware: NodeLevel5AppSupportMiddlewareFeature;
}): NodeLevel5AppSupportFeatures {
  return {
    route: input.route,
    response: input.response,
    middleware: input.middleware,
    asyncHandler: false,
    params: false,
    query: false,
    staticAssets: false,
    externalNetwork: false,
    backgroundTasks: false,
  };
}

function unsupportedLiveStateFeatures(
  feature: NodeLevel5AppSupportFeatureName,
): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({
      route: "unsupported-live-state",
      response: "not-proven",
      middleware: "not-proven",
    }),
    [feature]: true,
  };
}

function notProvenFeatures(feature: NodeLevel5AppSupportFeatureName): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "not-proven", response: "not-proven", middleware: "not-proven" }),
    [feature]: true,
  };
}

function supportedFeatureAssessment(
  features: NodeLevel5AppSupportFeatures,
): NodeLevel5AppSupportFeatureAssessment {
  return featureNames().reduce<NodeLevel5AppSupportFeatureAssessment>((assessment, name) => {
    assessment[name] = isFeaturePresent(features, name) ? "supported" : "not-proven";
    return assessment;
  }, emptyFeatureAssessment());
}

function refusedFeatureAssessment(
  feature: NodeLevel5AppSupportFeatureName,
): NodeLevel5AppSupportFeatureAssessment {
  return featureNames().reduce<NodeLevel5AppSupportFeatureAssessment>((assessment, name) => {
    assessment[name] = name === feature ? "refused" : "not-proven";
    return assessment;
  }, emptyFeatureAssessment());
}

function notProvenFeatureAssessment(
  feature: NodeLevel5AppSupportFeatureName,
): NodeLevel5AppSupportFeatureAssessment {
  return featureNames().reduce<NodeLevel5AppSupportFeatureAssessment>((assessment, name) => {
    assessment[name] = name === feature ? "not-proven" : "not-proven";
    return assessment;
  }, emptyFeatureAssessment());
}

function emptyFeatureAssessment(): NodeLevel5AppSupportFeatureAssessment {
  return {
    route: "not-proven",
    response: "not-proven",
    middleware: "not-proven",
    asyncHandler: "not-proven",
    params: "not-proven",
    query: "not-proven",
    staticAssets: "not-proven",
    externalNetwork: "not-proven",
    backgroundTasks: "not-proven",
  };
}

function isFeaturePresent(
  features: NodeLevel5AppSupportFeatures,
  name: NodeLevel5AppSupportFeatureName,
): boolean {
  if (name === "route") {
    return features.route !== "not-proven" && features.route !== "unsupported-live-state";
  }
  if (name === "response") {
    return features.response !== "not-proven";
  }
  if (name === "middleware") {
    return features.middleware !== "not-proven";
  }
  return features[name] === true;
}

function featureNames(): NodeLevel5AppSupportFeatureName[] {
  return [
    "route",
    "response",
    "middleware",
    "asyncHandler",
    "params",
    "query",
    "staticAssets",
    "externalNetwork",
    "backgroundTasks",
  ];
}

function refusalMarkers(): RefusalMarker[] {
  return [
    {
      id: "active-requests",
      appName: "active request app",
      reason: "active in-flight HTTP request",
      feature: "route",
    },
    {
      id: "worker-threads",
      appName: "worker thread app",
      reason: "worker thread state",
      feature: "backgroundTasks",
    },
    {
      id: "native-addons",
      appName: "native addon app",
      reason: "native addon state",
      feature: "backgroundTasks",
    },
    {
      id: "wasm-external-memory",
      appName: "Wasm external memory app",
      reason: "Wasm or external memory state",
      feature: "backgroundTasks",
    },
    {
      id: "tls-active-state",
      appName: "TLS active state app",
      reason: "active TLS session state",
      feature: "externalNetwork",
    },
    {
      id: "child-processes",
      appName: "child process app",
      reason: "live child process state",
      feature: "backgroundTasks",
    },
    {
      id: "filesystem-watchers",
      appName: "filesystem watcher app",
      reason: "filesystem watcher state",
      feature: "backgroundTasks",
    },
    {
      id: "websockets",
      appName: "websocket app",
      reason: "live websocket state",
      feature: "externalNetwork",
    },
  ];
}

function notProvenFeatureRows(): Array<{
  id: string;
  name: NodeLevel5AppSupportFeatureName;
  reason: string;
}> {
  return [
    {
      id: "json-response",
      name: "response",
      reason: "JSON response app row has no retained product corpus yet",
    },
    {
      id: "params",
      name: "params",
      reason: "dynamic route parameter app row has no retained product corpus yet",
    },
    {
      id: "query",
      name: "query",
      reason: "query string app row has no retained product corpus yet",
    },
    {
      id: "static-assets",
      name: "staticAssets",
      reason: "static asset app row has no retained product corpus yet",
    },
    {
      id: "external-network",
      name: "externalNetwork",
      reason: "external network or DB client app row has no safe support corpus yet",
    },
    {
      id: "background-tasks",
      name: "backgroundTasks",
      reason: "background timer/scheduler app row has no safe support corpus yet",
    },
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
    Boolean(row.evidence.proofRange) &&
    Boolean(row.evidence.corpusReport) &&
    row.limitations.length > 0 &&
    featureNames().every((name) => Boolean(row.featureAssessment[name]))
  );
}
