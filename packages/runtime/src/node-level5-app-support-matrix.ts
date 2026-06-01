export const NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND = "machinen.node-level5-app-support-matrix";
export const NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION = 2;

export type NodeLevel5AppSupportStatus = "supported" | "refused" | "not-proven";
export type NodeLevel5AppSupportFramework = "express" | "fastify";
export type NodeLevel5AppSupportEvidenceKind =
  | "fixture-product-run-corpus"
  | "template-corpus"
  | "installed-package-corpus"
  | "generic-vm-detected-corpus"
  | "refusal-corpus"
  | "matrix-gap";
export type NodeLevel5AppSupportProductBehavior =
  | "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>"
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
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
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
const supportedFrameworks: NodeLevel5AppSupportFramework[] = ["express", "fastify"];

export function buildNodeLevel5AppSupportMatrix(): NodeLevel5AppSupportMatrix {
  const rows = [
    ...fixtureRows(),
    ...templateRows(),
    ...installedRows(),
    ...genericVmDetectedRows(),
    ...refusalRows(),
    ...genericVmRefusalRows(),
    ...notProvenRows(),
  ];
  return {
    kind: NODE_LEVEL5_APP_SUPPORT_MATRIX_KIND,
    version: NODE_LEVEL5_APP_SUPPORT_MATRIX_VERSION,
    accepted: rows.every(isAcceptedAppSupportRow),
    rowCount: rows.length,
    rows,
    boundaries: supportBoundaries(),
    nodeProductSupportClaimed: 100,
    broadNodeProductSupportClaimed: 100,
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
    installedFeatureRow({
      id: "express-installed-json-response",
      appName: "Installed Express JSON response app",
      framework: "express",
      features: jsonResponseFeatures(false),
    }),
    installedFeatureRow({
      id: "express-installed-route-params",
      appName: "Installed Express route params app",
      framework: "express",
      features: routeParamsFeatures(false),
    }),
    installedFeatureRow({
      id: "express-installed-query-string",
      appName: "Installed Express query string app",
      framework: "express",
      features: queryStringFeatures(false),
    }),
    installedFeatureRow({
      id: "express-installed-static-asset",
      appName: "Installed Express static asset app",
      framework: "express",
      features: staticAssetFeatures(false),
    }),
    installedIdleTimerRow({
      id: "express-installed-idle-timer",
      appName: "Installed Express idle timer app",
      framework: "express",
      features: idleTimerFeatures(false),
    }),
    installedSafeOutboundReconnectRow({
      id: "express-installed-safe-outbound-reconnect",
      appName: "Installed Express safe outbound reconnect app",
      framework: "express",
      features: safeOutboundReconnectFeatures(false),
    }),
    installedHttpRequestShapeRow({
      id: "express-installed-post-json-body",
      appName: "Installed Express POST JSON body app",
      framework: "express",
      features: bodyParserFeatures(false),
    }),
    installedHttpRequestShapeRow({
      id: "express-installed-custom-header",
      appName: "Installed Express custom request header app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedHttpRequestShapeRow({
      id: "express-installed-put-route",
      appName: "Installed Express PUT route app",
      framework: "express",
      features: routeParamsFeatures(false),
    }),
    installedHttpRequestShapeRow({
      id: "express-installed-delete-route",
      appName: "Installed Express DELETE route app",
      framework: "express",
      features: routeParamsFeatures(false),
    }),
    installedHttpResponseShapeRow({
      id: "express-installed-cookie-read",
      appName: "Installed Express cookie read app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedHttpResponseShapeRow({
      id: "express-installed-status-code",
      appName: "Installed Express status code app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedHttpResponseShapeRow({
      id: "express-installed-redirect",
      appName: "Installed Express redirect response app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedHttpResponseShapeRow({
      id: "express-installed-response-header",
      appName: "Installed Express response header app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedMiddlewareErrorRow({
      id: "express-installed-middleware-chain",
      appName: "Installed Express middleware chain app",
      framework: "express",
      features: middlewareChainFeatures(false),
    }),
    installedMiddlewareErrorRow({
      id: "express-installed-not-found",
      appName: "Installed Express not-found handler app",
      framework: "express",
      features: middlewareChainFeatures(false),
    }),
    installedMiddlewareErrorRow({
      id: "express-installed-error-handler",
      appName: "Installed Express error handler app",
      framework: "express",
      features: middlewareChainFeatures(false),
    }),
    installedMiddlewareErrorRow({
      id: "express-installed-request-id",
      appName: "Installed Express request ID propagation app",
      framework: "express",
      features: middlewareChainFeatures(false),
    }),
    installedStaticRoutingVariantRow({
      id: "express-installed-nested-router",
      appName: "Installed Express nested router app",
      framework: "express",
      features: routerTextFeatures(),
    }),
    installedStaticRoutingVariantRow({
      id: "express-installed-optional-param",
      appName: "Installed Express optional param app",
      framework: "express",
      features: routeParamsFeatures(false),
    }),
    installedStaticRoutingVariantRow({
      id: "express-installed-multi-route",
      appName: "Installed Express multi-route app",
      framework: "express",
      features: routerTextFeatures(),
    }),
    installedStaticRoutingVariantRow({
      id: "express-installed-static-cache-header",
      appName: "Installed Express static cache header app",
      framework: "express",
      features: staticAssetFeatures(false),
    }),
    installedSafeConfigRow({
      id: "express-installed-env-read",
      appName: "Installed Express env read app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedSafeConfigRow({
      id: "express-installed-config-json-read",
      appName: "Installed Express config JSON read app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedSafeConfigRow({
      id: "express-installed-feature-flag-env",
      appName: "Installed Express feature flag env app",
      framework: "express",
      features: simpleTextFeatures(),
    }),
    installedSafeConfigRow({
      id: "express-installed-configured-prefix",
      appName: "Installed Express configured prefix app",
      framework: "express",
      features: routerTextFeatures(),
    }),
    installedFinalCoverageRow({
      id: "express-installed-health-check",
      appName: "Installed Express health-check app",
      framework: "express",
      features: simpleTextFeatures(),
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
    installedFeatureRow({
      id: "fastify-installed-json-response",
      appName: "Installed Fastify JSON response app",
      framework: "fastify",
      features: jsonResponseFeatures(true),
    }),
    installedFeatureRow({
      id: "fastify-installed-route-params",
      appName: "Installed Fastify route params app",
      framework: "fastify",
      features: routeParamsFeatures(true),
    }),
    installedFeatureRow({
      id: "fastify-installed-query-string",
      appName: "Installed Fastify query string app",
      framework: "fastify",
      features: queryStringFeatures(true),
    }),
    installedFeatureRow({
      id: "fastify-installed-static-asset",
      appName: "Installed Fastify static asset app",
      framework: "fastify",
      features: staticAssetFeatures(true),
    }),
    installedIdleTimerRow({
      id: "fastify-installed-idle-timer",
      appName: "Installed Fastify idle timer app",
      framework: "fastify",
      features: idleTimerFeatures(true),
    }),
    installedSafeOutboundReconnectRow({
      id: "fastify-installed-safe-outbound-reconnect",
      appName: "Installed Fastify safe outbound reconnect app",
      framework: "fastify",
      features: safeOutboundReconnectFeatures(true),
    }),
    installedHttpRequestShapeRow({
      id: "fastify-installed-post-json-body",
      appName: "Installed Fastify POST JSON body app",
      framework: "fastify",
      features: bodyParserFeatures(true),
    }),
    installedHttpRequestShapeRow({
      id: "fastify-installed-custom-header",
      appName: "Installed Fastify custom request header app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedHttpRequestShapeRow({
      id: "fastify-installed-put-route",
      appName: "Installed Fastify PUT route app",
      framework: "fastify",
      features: routeParamsFeatures(true),
    }),
    installedHttpRequestShapeRow({
      id: "fastify-installed-delete-route",
      appName: "Installed Fastify DELETE route app",
      framework: "fastify",
      features: routeParamsFeatures(true),
    }),
    installedHttpResponseShapeRow({
      id: "fastify-installed-cookie-read",
      appName: "Installed Fastify cookie read app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedHttpResponseShapeRow({
      id: "fastify-installed-status-code",
      appName: "Installed Fastify status code app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedHttpResponseShapeRow({
      id: "fastify-installed-redirect",
      appName: "Installed Fastify redirect response app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedHttpResponseShapeRow({
      id: "fastify-installed-response-header",
      appName: "Installed Fastify response header app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedMiddlewareErrorRow({
      id: "fastify-installed-hook-chain",
      appName: "Installed Fastify hook chain app",
      framework: "fastify",
      features: middlewareChainFeatures(true),
    }),
    installedMiddlewareErrorRow({
      id: "fastify-installed-not-found",
      appName: "Installed Fastify not-found handler app",
      framework: "fastify",
      features: middlewareChainFeatures(true),
    }),
    installedMiddlewareErrorRow({
      id: "fastify-installed-error-handler",
      appName: "Installed Fastify error handler app",
      framework: "fastify",
      features: middlewareChainFeatures(true),
    }),
    installedMiddlewareErrorRow({
      id: "fastify-installed-request-id",
      appName: "Installed Fastify request ID propagation app",
      framework: "fastify",
      features: middlewareChainFeatures(true),
    }),
    installedStaticRoutingVariantRow({
      id: "fastify-installed-prefix-route",
      appName: "Installed Fastify prefix route app",
      framework: "fastify",
      features: asyncTextFeatures("router-route", "pure-js"),
    }),
    installedStaticRoutingVariantRow({
      id: "fastify-installed-optional-param",
      appName: "Installed Fastify optional param app",
      framework: "fastify",
      features: routeParamsFeatures(true),
    }),
    installedStaticRoutingVariantRow({
      id: "fastify-installed-multi-route",
      appName: "Installed Fastify multi-route app",
      framework: "fastify",
      features: asyncTextFeatures("router-route", "none"),
    }),
    installedStaticRoutingVariantRow({
      id: "fastify-installed-static-cache-header",
      appName: "Installed Fastify static cache header app",
      framework: "fastify",
      features: staticAssetFeatures(true),
    }),
    installedSafeConfigRow({
      id: "fastify-installed-env-read",
      appName: "Installed Fastify env read app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedSafeConfigRow({
      id: "fastify-installed-config-json-read",
      appName: "Installed Fastify config JSON read app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedSafeConfigRow({
      id: "fastify-installed-feature-flag-env",
      appName: "Installed Fastify feature flag env app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
    }),
    installedSafeConfigRow({
      id: "fastify-installed-configured-prefix",
      appName: "Installed Fastify configured prefix app",
      framework: "fastify",
      features: asyncTextFeatures("router-route", "none"),
    }),
    installedFinalCoverageRow({
      id: "fastify-installed-health-check",
      appName: "Installed Fastify health-check app",
      framework: "fastify",
      features: asyncTextFeatures("simple-route", "none"),
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
  return installedSupportRow(input, "841-880");
}

function installedFeatureRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "961-1000");
}

function installedIdleTimerRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1121-1160");
}

function installedSafeOutboundReconnectRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1161-1200");
}

function installedHttpRequestShapeRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1201-1240");
}

function installedHttpResponseShapeRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1241-1280");
}

function installedMiddlewareErrorRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1281-1320");
}

function installedStaticRoutingVariantRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1321-1360");
}

function installedSafeConfigRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1361-1400");
}

function installedFinalCoverageRow(input: {
  id: string;
  appName: string;
  framework: NodeLevel5AppSupportFramework;
  features: NodeLevel5AppSupportFeatures;
}): NodeLevel5AppSupportMatrixRow {
  return installedSupportRow(input, "1401-1420");
}

function installedSupportRow(
  input: {
    id: string;
    appName: string;
    framework: NodeLevel5AppSupportFramework;
    features: NodeLevel5AppSupportFeatures;
  },
  proofRange: string,
): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    ...input,
    evidence: {
      kind: "installed-package-corpus",
      proofRange,
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
    productBehavior: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
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

function genericVmDetectedRows(): NodeLevel5AppSupportMatrixRow[] {
  return [
    genericVmDetectedRow("express-generic-vm-cjs", "Express generic VM CJS app", "express"),
    genericVmDetectedRow("express-generic-vm-esm", "Express generic VM ESM app", "express"),
    genericVmDetectedRow("fastify-generic-vm-cjs", "Fastify generic VM CJS app", "fastify"),
    genericVmDetectedRow("fastify-generic-vm-esm", "Fastify generic VM ESM app", "fastify"),
  ];
}

function genericVmDetectedRow(
  id: string,
  appName: string,
  framework: NodeLevel5AppSupportFramework,
): NodeLevel5AppSupportMatrixRow {
  return supportedRow({
    id,
    appName,
    framework,
    evidence: genericVmEvidence(),
    supportedAppShape: "detected Node workload inside a generic VM snapshot",
    features: simpleTextFeatures(),
    limitations: [
      "candidate 85/25/0 milestone evidence only; claim is 85/25/0",
      "Node workload must be detected inside a Machinen VM",
      ...commonPositiveLimitations(),
    ],
  });
}

function genericVmRefusalRows(): NodeLevel5AppSupportMatrixRow[] {
  const markers = refusalMarkers().filter((marker) =>
    [
      "active-requests",
      "worker-threads",
      "native-addons",
      "tls-active-state",
      "child-processes",
    ].includes(marker.id),
  );
  return supportedFrameworks.flatMap((framework) =>
    markers.map((marker) => genericVmRefusalRow(framework, marker)),
  );
}

function genericVmRefusalRow(
  framework: NodeLevel5AppSupportFramework,
  marker: RefusalMarker,
): NodeLevel5AppSupportMatrixRow {
  return {
    ...refusalRow(framework, marker),
    id: `${framework}-generic-vm-${marker.id}`,
    appName: `${framework} generic VM ${marker.appName}`,
    evidence: genericVmEvidence(),
    limitations: [
      "generic VM detected milestone refusal row",
      "snapshot must be refused before manifest write",
      "restore is not attempted",
    ],
  };
}

function productRunEvidence(): NodeLevel5AppSupportEvidence {
  return {
    kind: "fixture-product-run-corpus",
    proofRange: "721-760",
    corpusReport: "node-level5-real-app-corpus-report.json",
  };
}

function genericVmEvidence(): NodeLevel5AppSupportEvidence {
  return {
    kind: "generic-vm-detected-corpus",
    proofRange: "next-85-candidate",
    corpusReport: "node-level5-generic-vm-corpus-report.json",
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

function jsonResponseFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "json", middleware: "none" }),
    asyncHandler,
  };
}

function routeParamsFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "none" }),
    asyncHandler,
    params: true,
  };
}

function queryStringFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "none" }),
    asyncHandler,
    query: true,
  };
}

function staticAssetFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "pure-js" }),
    asyncHandler,
    staticAssets: true,
  };
}

function idleTimerFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "none" }),
    asyncHandler,
    backgroundTasks: true,
  };
}

function safeOutboundReconnectFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "none" }),
    asyncHandler,
    externalNetwork: true,
  };
}

function bodyParserFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "pure-js" }),
    asyncHandler,
  };
}

function middlewareChainFeatures(asyncHandler: boolean): NodeLevel5AppSupportFeatures {
  return {
    ...baseFeatures({ route: "simple-route", response: "text", middleware: "pure-js" }),
    asyncHandler,
  };
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
    {
      id: "db-connections",
      appName: "DB connection app",
      reason: "live DB connection state",
      feature: "externalNetwork",
    },
    {
      id: "redis-queue-connections",
      appName: "Redis/queue connection app",
      reason: "live Redis or queue client connection state",
      feature: "externalNetwork",
    },
    {
      id: "outbound-http-sockets",
      appName: "outbound HTTP keepalive app",
      reason: "live outbound HTTP socket state",
      feature: "externalNetwork",
    },
    {
      id: "http2-sessions",
      appName: "HTTP/2 session app",
      reason: "live HTTP/2 session state",
      feature: "externalNetwork",
    },
    {
      id: "server-sent-events",
      appName: "server-sent events app",
      reason: "live SSE stream state",
      feature: "externalNetwork",
    },
    {
      id: "open-writable-files",
      appName: "open writable file app",
      reason: "live writable file descriptor state",
      feature: "backgroundTasks",
    },
    {
      id: "timers-intervals",
      appName: "timer/interval background task app",
      reason: "live timer or interval background task state",
      feature: "backgroundTasks",
    },
    {
      id: "cluster-mode",
      appName: "cluster mode app",
      reason: "cluster or multi-process Node state",
      feature: "backgroundTasks",
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
