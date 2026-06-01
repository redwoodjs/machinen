import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sensiblePackage from "@fastify/sensible/package.json" with { type: "json" };
import expressPackage from "express/package.json" with { type: "json" };
import fastifyPackage from "fastify/package.json" with { type: "json" };

import type { NodeLevel5RealAppCorpusFramework } from "../../../packages/runtime/src/node-level5-real-app-corpus.ts";
import type { NodeLevel5ProductSnapshotDirection } from "../../../packages/runtime/src/node-level5-product-snapshot.ts";
import {
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  writeNodeLevel5InstalledThirdPartyAppCorpusReport,
  type NodeLevel5InstalledThirdPartyAppCorpusRow,
  type NodeLevel5InstalledThirdPartyAppSource,
} from "../../../packages/runtime/src/node-level5-installed-third-party-app-corpus.ts";
import {
  isNodeLevel5RealAppCorpusMain,
  nodeLevel5RealAppCorpusDirections,
  nodeLevel5AppCorpusIdentity,
  nodeLevel5DeclaredSubsetCorpusFields,
  nodeLevel5HttpEvidenceFromProductRun,
  nodeLevel5RealAppCorpusRepoRoot,
  parseNodeLevel5RealAppCorpusOutArgs,
  runNodeLevel5ProductPathForNamedApp,
  runNodeLevel5RealAppCorpusCliJson,
  writeNodeLevel5BehaviorConfig,
} from "./node-level5-real-app-corpus-script-utils.ts";

type InstalledThirdPartyAppDefinition = {
  appName: string;
  source: NodeLevel5InstalledThirdPartyAppSource;
  framework: NodeLevel5RealAppCorpusFramework;
  routePath: string;
  method?: string;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  expectedStatus?: number;
  expectedHeaders?: Record<string, string>;
  env?: Record<string, string>;
  body: string;
  headerValue: string;
  installedPackage: "express" | "fastify";
  installedPackageVersion: string;
  dependencies: Record<string, string>;
  serverSource: (input: InstalledThirdPartyAppDefinition) => string;
};

type InstalledThirdPartyAppCorpusSummary = {
  kind: "machinen.node-level5-installed-third-party-app-corpus-summary";
  accepted: boolean;
  outDir: string;
  installedThirdPartyAppReportPath: string;
  rowCount: number;
  rows: NodeLevel5InstalledThirdPartyAppCorpusRow[];
  installedThirdPartyAppVerification: ReturnType<
    typeof verifyNodeLevel5InstalledThirdPartyAppCorpusReport
  >;
  releaseGate: Record<string, any>;
  productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const installedThirdPartyPackageVersions = {
  express: String(expressPackage.version),
  fastify: String(fastifyPackage.version),
  "@fastify/sensible": String(sensiblePackage.version),
};

const installedThirdPartyApps: InstalledThirdPartyAppDefinition[] = [
  {
    appName: "express-installed-hello-world",
    source: "express-installed-hello-world",
    framework: "express",
    routePath: "/",
    body: "hello from installed express",
    headerValue: "express-installed-hello-world",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressHelloWorldSource,
  },
  {
    appName: "express-installed-router",
    source: "express-installed-router",
    framework: "express",
    routePath: "/users/42",
    body: "installed express router user 42",
    headerValue: "express-installed-router",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRouterSource,
  },
  {
    appName: "express-installed-json-response",
    source: "express-installed-json-response",
    framework: "express",
    routePath: "/json",
    body: JSON.stringify({ message: "installed express json" }),
    headerValue: "express-installed-json-response",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressJsonResponseSource,
  },
  {
    appName: "express-installed-route-params",
    source: "express-installed-route-params",
    framework: "express",
    routePath: "/users/42",
    body: "installed express params user 42",
    headerValue: "express-installed-route-params",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRouteParamsSource,
  },
  {
    appName: "express-installed-query-string",
    source: "express-installed-query-string",
    framework: "express",
    routePath: "/search?term=machinen",
    body: "installed express query machinen",
    headerValue: "express-installed-query-string",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressQueryStringSource,
  },
  {
    appName: "express-installed-static-asset",
    source: "express-installed-static-asset",
    framework: "express",
    routePath: "/assets/message.txt",
    body: "installed express static asset",
    headerValue: "express-installed-static-asset",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressStaticAssetSource,
  },
  {
    appName: "express-installed-idle-timer",
    source: "express-installed-idle-timer",
    framework: "express",
    routePath: "/timer/status",
    body: "installed express idle timer active",
    headerValue: "express-installed-idle-timer",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressIdleTimerSource,
  },
  {
    appName: "express-installed-safe-outbound-reconnect",
    source: "express-installed-safe-outbound-reconnect",
    framework: "express",
    routePath: "/outbound/status",
    body: "installed express safe outbound reconnect active",
    headerValue: "express-installed-safe-outbound-reconnect",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressSafeOutboundReconnectSource,
  },
  {
    appName: "express-installed-post-json-body",
    source: "express-installed-post-json-body",
    framework: "express",
    routePath: "/body",
    method: "POST",
    requestBody: JSON.stringify({ name: "machinen" }),
    requestHeaders: { "content-type": "application/json" },
    body: "installed express post json machinen",
    headerValue: "express-installed-post-json-body",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressPostJsonBodySource,
  },
  {
    appName: "express-installed-custom-header",
    source: "express-installed-custom-header",
    framework: "express",
    routePath: "/headers",
    requestHeaders: { "x-machinen-request": "express-header" },
    body: "installed express custom header express-header",
    headerValue: "express-installed-custom-header",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressCustomHeaderSource,
  },
  {
    appName: "express-installed-put-route",
    source: "express-installed-put-route",
    framework: "express",
    routePath: "/items/42",
    method: "PUT",
    body: "installed express put route 42",
    headerValue: "express-installed-put-route",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressPutRouteSource,
  },
  {
    appName: "express-installed-delete-route",
    source: "express-installed-delete-route",
    framework: "express",
    routePath: "/items/42",
    method: "DELETE",
    body: "installed express delete route 42",
    headerValue: "express-installed-delete-route",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressDeleteRouteSource,
  },
  {
    appName: "express-installed-cookie-read",
    source: "express-installed-cookie-read",
    framework: "express",
    routePath: "/cookies",
    requestHeaders: { cookie: "session=express-cookie" },
    body: "installed express cookie express-cookie",
    headerValue: "express-installed-cookie-read",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressCookieReadSource,
  },
  {
    appName: "express-installed-status-code",
    source: "express-installed-status-code",
    framework: "express",
    routePath: "/created",
    expectedStatus: 201,
    body: "installed express status created",
    headerValue: "express-installed-status-code",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressStatusCodeSource,
  },
  {
    appName: "express-installed-redirect",
    source: "express-installed-redirect",
    framework: "express",
    routePath: "/redirect",
    expectedStatus: 302,
    expectedHeaders: { location: "/redirect-target" },
    body: "installed express redirect /redirect-target",
    headerValue: "express-installed-redirect",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRedirectSource,
  },
  {
    appName: "express-installed-response-header",
    source: "express-installed-response-header",
    framework: "express",
    routePath: "/response-header",
    expectedHeaders: { "x-machinen-response-feature": "express-response-header" },
    body: "installed express response header",
    headerValue: "express-installed-response-header",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressResponseHeaderSource,
  },
  {
    appName: "express-installed-nested-router",
    source: "express-installed-nested-router",
    framework: "express",
    routePath: "/api/v1/users/42",
    body: "installed express nested router user 42",
    headerValue: "express-installed-nested-router",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressNestedRouterSource,
  },
  {
    appName: "express-installed-optional-param",
    source: "express-installed-optional-param",
    framework: "express",
    routePath: "/optional/machinen",
    body: "installed express optional param machinen",
    headerValue: "express-installed-optional-param",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressOptionalParamSource,
  },
  {
    appName: "express-installed-multi-route",
    source: "express-installed-multi-route",
    framework: "express",
    routePath: "/multi/two",
    body: "installed express multi route two",
    headerValue: "express-installed-multi-route",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressMultiRouteSource,
  },
  {
    appName: "express-installed-static-cache-header",
    source: "express-installed-static-cache-header",
    framework: "express",
    routePath: "/cached/message.txt",
    expectedHeaders: { "cache-control": "public, max-age=60" },
    body: "installed express static cache header",
    headerValue: "express-installed-static-cache-header",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressStaticCacheHeaderSource,
  },
  {
    appName: "express-installed-env-read",
    source: "express-installed-env-read",
    framework: "express",
    routePath: "/env",
    env: { MACHINEN_SELECTED_ENV: "express-env" },
    body: "installed express env express-env",
    headerValue: "express-installed-env-read",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressEnvReadSource,
  },
  {
    appName: "express-installed-config-json-read",
    source: "express-installed-config-json-read",
    framework: "express",
    routePath: "/config",
    body: "installed express config json express-config",
    headerValue: "express-installed-config-json-read",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressConfigJsonReadSource,
  },
  {
    appName: "express-installed-feature-flag-env",
    source: "express-installed-feature-flag-env",
    framework: "express",
    routePath: "/flag",
    env: { MACHINEN_FEATURE_FLAG: "express-enabled" },
    body: "installed express feature flag express-enabled",
    headerValue: "express-installed-feature-flag-env",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressFeatureFlagEnvSource,
  },
  {
    appName: "express-installed-configured-prefix",
    source: "express-installed-configured-prefix",
    framework: "express",
    routePath: "/configured/status",
    body: "installed express configured prefix ok",
    headerValue: "express-installed-configured-prefix",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressConfiguredPrefixSource,
  },
  {
    appName: "express-installed-health-check",
    source: "express-installed-health-check",
    framework: "express",
    routePath: "/healthz",
    body: "installed express health check ok",
    headerValue: "express-installed-health-check",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressHealthCheckSource,
  },
  {
    appName: "express-installed-middleware-chain",
    source: "express-installed-middleware-chain",
    framework: "express",
    routePath: "/middleware",
    body: "installed express middleware chain ok",
    headerValue: "express-installed-middleware-chain",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressMiddlewareChainSource,
  },
  {
    appName: "express-installed-not-found",
    source: "express-installed-not-found",
    framework: "express",
    routePath: "/missing",
    expectedStatus: 404,
    body: "installed express not found handled",
    headerValue: "express-installed-not-found",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressNotFoundSource,
  },
  {
    appName: "express-installed-error-handler",
    source: "express-installed-error-handler",
    framework: "express",
    routePath: "/error",
    expectedStatus: 500,
    body: "installed express error handled",
    headerValue: "express-installed-error-handler",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressErrorHandlerSource,
  },
  {
    appName: "express-installed-request-id",
    source: "express-installed-request-id",
    framework: "express",
    routePath: "/request-id",
    requestHeaders: { "x-request-id": "express-request-id" },
    body: "installed express request id express-request-id",
    headerValue: "express-installed-request-id",
    installedPackage: "express",
    installedPackageVersion: installedThirdPartyPackageVersions.express,
    dependencies: { express: `^${installedThirdPartyPackageVersions.express}` },
    serverSource: expressRequestIdSource,
  },
  {
    appName: "fastify-installed-getting-started",
    source: "fastify-installed-getting-started",
    framework: "fastify",
    routePath: "/",
    body: "hello from installed fastify",
    headerValue: "fastify-installed-getting-started",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyGettingStartedSource,
  },
  {
    appName: "fastify-installed-json-response",
    source: "fastify-installed-json-response",
    framework: "fastify",
    routePath: "/json",
    body: JSON.stringify({ message: "installed fastify json" }),
    headerValue: "fastify-installed-json-response",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyJsonResponseSource,
  },
  {
    appName: "fastify-installed-route-params",
    source: "fastify-installed-route-params",
    framework: "fastify",
    routePath: "/users/42",
    body: "installed fastify params user 42",
    headerValue: "fastify-installed-route-params",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyRouteParamsSource,
  },
  {
    appName: "fastify-installed-query-string",
    source: "fastify-installed-query-string",
    framework: "fastify",
    routePath: "/search?term=machinen",
    body: "installed fastify query machinen",
    headerValue: "fastify-installed-query-string",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyQueryStringSource,
  },
  {
    appName: "fastify-installed-static-asset",
    source: "fastify-installed-static-asset",
    framework: "fastify",
    routePath: "/assets/message.txt",
    body: "installed fastify static asset",
    headerValue: "fastify-installed-static-asset",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyStaticAssetSource,
  },
  {
    appName: "fastify-installed-idle-timer",
    source: "fastify-installed-idle-timer",
    framework: "fastify",
    routePath: "/timer/status",
    body: "installed fastify idle timer active",
    headerValue: "fastify-installed-idle-timer",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyIdleTimerSource,
  },
  {
    appName: "fastify-installed-safe-outbound-reconnect",
    source: "fastify-installed-safe-outbound-reconnect",
    framework: "fastify",
    routePath: "/outbound/status",
    body: "installed fastify safe outbound reconnect active",
    headerValue: "fastify-installed-safe-outbound-reconnect",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifySafeOutboundReconnectSource,
  },
  {
    appName: "fastify-installed-post-json-body",
    source: "fastify-installed-post-json-body",
    framework: "fastify",
    routePath: "/body",
    method: "POST",
    requestBody: JSON.stringify({ name: "machinen" }),
    requestHeaders: { "content-type": "application/json" },
    body: "installed fastify post json machinen",
    headerValue: "fastify-installed-post-json-body",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyPostJsonBodySource,
  },
  {
    appName: "fastify-installed-custom-header",
    source: "fastify-installed-custom-header",
    framework: "fastify",
    routePath: "/headers",
    requestHeaders: { "x-machinen-request": "fastify-header" },
    body: "installed fastify custom header fastify-header",
    headerValue: "fastify-installed-custom-header",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyCustomHeaderSource,
  },
  {
    appName: "fastify-installed-put-route",
    source: "fastify-installed-put-route",
    framework: "fastify",
    routePath: "/items/42",
    method: "PUT",
    body: "installed fastify put route 42",
    headerValue: "fastify-installed-put-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyPutRouteSource,
  },
  {
    appName: "fastify-installed-delete-route",
    source: "fastify-installed-delete-route",
    framework: "fastify",
    routePath: "/items/42",
    method: "DELETE",
    body: "installed fastify delete route 42",
    headerValue: "fastify-installed-delete-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyDeleteRouteSource,
  },
  {
    appName: "fastify-installed-cookie-read",
    source: "fastify-installed-cookie-read",
    framework: "fastify",
    routePath: "/cookies",
    requestHeaders: { cookie: "session=fastify-cookie" },
    body: "installed fastify cookie fastify-cookie",
    headerValue: "fastify-installed-cookie-read",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyCookieReadSource,
  },
  {
    appName: "fastify-installed-status-code",
    source: "fastify-installed-status-code",
    framework: "fastify",
    routePath: "/created",
    expectedStatus: 201,
    body: "installed fastify status created",
    headerValue: "fastify-installed-status-code",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyStatusCodeSource,
  },
  {
    appName: "fastify-installed-redirect",
    source: "fastify-installed-redirect",
    framework: "fastify",
    routePath: "/redirect",
    expectedStatus: 302,
    expectedHeaders: { location: "/redirect-target" },
    body: "installed fastify redirect /redirect-target",
    headerValue: "fastify-installed-redirect",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyRedirectSource,
  },
  {
    appName: "fastify-installed-response-header",
    source: "fastify-installed-response-header",
    framework: "fastify",
    routePath: "/response-header",
    expectedHeaders: { "x-machinen-response-feature": "fastify-response-header" },
    body: "installed fastify response header",
    headerValue: "fastify-installed-response-header",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyResponseHeaderSource,
  },
  {
    appName: "fastify-installed-prefix-route",
    source: "fastify-installed-prefix-route",
    framework: "fastify",
    routePath: "/api/v1/users/42",
    body: "installed fastify prefix route user 42",
    headerValue: "fastify-installed-prefix-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyPrefixRouteSource,
  },
  {
    appName: "fastify-installed-optional-param",
    source: "fastify-installed-optional-param",
    framework: "fastify",
    routePath: "/optional/machinen",
    body: "installed fastify optional param machinen",
    headerValue: "fastify-installed-optional-param",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyOptionalParamSource,
  },
  {
    appName: "fastify-installed-multi-route",
    source: "fastify-installed-multi-route",
    framework: "fastify",
    routePath: "/multi/two",
    body: "installed fastify multi route two",
    headerValue: "fastify-installed-multi-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyMultiRouteSource,
  },
  {
    appName: "fastify-installed-static-cache-header",
    source: "fastify-installed-static-cache-header",
    framework: "fastify",
    routePath: "/cached/message.txt",
    expectedHeaders: { "cache-control": "public, max-age=60" },
    body: "installed fastify static cache header",
    headerValue: "fastify-installed-static-cache-header",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyStaticCacheHeaderSource,
  },
  {
    appName: "fastify-installed-env-read",
    source: "fastify-installed-env-read",
    framework: "fastify",
    routePath: "/env",
    env: { MACHINEN_SELECTED_ENV: "fastify-env" },
    body: "installed fastify env fastify-env",
    headerValue: "fastify-installed-env-read",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyEnvReadSource,
  },
  {
    appName: "fastify-installed-config-json-read",
    source: "fastify-installed-config-json-read",
    framework: "fastify",
    routePath: "/config",
    body: "installed fastify config json fastify-config",
    headerValue: "fastify-installed-config-json-read",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyConfigJsonReadSource,
  },
  {
    appName: "fastify-installed-feature-flag-env",
    source: "fastify-installed-feature-flag-env",
    framework: "fastify",
    routePath: "/flag",
    env: { MACHINEN_FEATURE_FLAG: "fastify-enabled" },
    body: "installed fastify feature flag fastify-enabled",
    headerValue: "fastify-installed-feature-flag-env",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyFeatureFlagEnvSource,
  },
  {
    appName: "fastify-installed-configured-prefix",
    source: "fastify-installed-configured-prefix",
    framework: "fastify",
    routePath: "/configured/status",
    body: "installed fastify configured prefix ok",
    headerValue: "fastify-installed-configured-prefix",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyConfiguredPrefixSource,
  },
  {
    appName: "fastify-installed-health-check",
    source: "fastify-installed-health-check",
    framework: "fastify",
    routePath: "/healthz",
    body: "installed fastify health check ok",
    headerValue: "fastify-installed-health-check",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyHealthCheckSource,
  },
  {
    appName: "fastify-installed-hook-chain",
    source: "fastify-installed-hook-chain",
    framework: "fastify",
    routePath: "/middleware",
    body: "installed fastify hook chain ok",
    headerValue: "fastify-installed-hook-chain",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyHookChainSource,
  },
  {
    appName: "fastify-installed-not-found",
    source: "fastify-installed-not-found",
    framework: "fastify",
    routePath: "/missing",
    expectedStatus: 404,
    body: "installed fastify not found handled",
    headerValue: "fastify-installed-not-found",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyNotFoundSource,
  },
  {
    appName: "fastify-installed-error-handler",
    source: "fastify-installed-error-handler",
    framework: "fastify",
    routePath: "/error",
    expectedStatus: 500,
    body: "installed fastify error handled",
    headerValue: "fastify-installed-error-handler",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyErrorHandlerSource,
  },
  {
    appName: "fastify-installed-request-id",
    source: "fastify-installed-request-id",
    framework: "fastify",
    routePath: "/request-id",
    requestHeaders: { "x-request-id": "fastify-request-id" },
    body: "installed fastify request id fastify-request-id",
    headerValue: "fastify-installed-request-id",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: { fastify: `^${installedThirdPartyPackageVersions.fastify}` },
    serverSource: fastifyRequestIdSource,
  },
  {
    appName: "fastify-installed-plugin-route",
    source: "fastify-installed-plugin-route",
    framework: "fastify",
    routePath: "/plugins/status",
    body: "installed fastify plugin route ok",
    headerValue: "fastify-installed-plugin-route",
    installedPackage: "fastify",
    installedPackageVersion: installedThirdPartyPackageVersions.fastify,
    dependencies: {
      "@fastify/sensible": `^${installedThirdPartyPackageVersions["@fastify/sensible"]}`,
      fastify: `^${installedThirdPartyPackageVersions.fastify}`,
    },
    serverSource: fastifyPluginRouteSource,
  },
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generateInstalledThirdPartyAppCorpus(options.outDir);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`wrote ${summary.installedThirdPartyAppReportPath}\n`);
}

export function generateInstalledThirdPartyAppCorpus(
  outDir: string,
): InstalledThirdPartyAppCorpusSummary {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rows = installedThirdPartyApps.flatMap((app) =>
    nodeLevel5RealAppCorpusDirections.map((direction) =>
      runAppProductCommands(outDir, app, direction),
    ),
  );
  const installedThirdPartyAppReportPath = join(
    outDir,
    "node-level5-installed-third-party-app-corpus-report.json",
  );
  const report = writeNodeLevel5InstalledThirdPartyAppCorpusReport({
    path: installedThirdPartyAppReportPath,
    rows,
  });
  const installedThirdPartyAppVerification =
    verifyNodeLevel5InstalledThirdPartyAppCorpusReport(report);
  const releaseGate = runNodeLevel5RealAppCorpusCliJson([
    "node-level5",
    "release-gate",
    "--include-installed-third-party-app-corpus",
    "--installed-third-party-app-corpus-report",
    installedThirdPartyAppReportPath,
    "--json",
  ]);
  const summary: InstalledThirdPartyAppCorpusSummary = {
    kind: "machinen.node-level5-installed-third-party-app-corpus-summary",
    accepted: installedThirdPartyAppVerification.accepted && releaseGate.accepted === true,
    outDir,
    installedThirdPartyAppReportPath,
    rowCount: rows.length,
    rows,
    installedThirdPartyAppVerification,
    releaseGate,
    productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-installed-third-party-app-corpus-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function runAppProductCommands(
  outDir: string,
  app: InstalledThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): NodeLevel5InstalledThirdPartyAppCorpusRow {
  const appDir = appDirFor(outDir, app, direction);
  return runNodeLevel5ProductPathForNamedApp({
    outDir,
    appName: app.appName,
    appDir,
    direction,
    row: ({ snapshot, restore }) => ({
      ...nodeLevel5AppCorpusIdentity(app, direction),
      installedPackage: app.installedPackage,
      installedPackageVersion: app.installedPackageVersion,
      ...nodeLevel5HttpEvidenceFromProductRun(snapshot, restore),
      ...nodeLevel5DeclaredSubsetCorpusFields(),
    }),
  });
}

function appDirFor(
  outDir: string,
  app: InstalledThirdPartyAppDefinition,
  direction: NodeLevel5ProductSnapshotDirection,
): string {
  const appDir = join(outDir, "fixtures", `${app.appName}-${direction}`);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: app.appName, type: "module", dependencies: app.dependencies }, null, 2)}\n`,
  );
  linkInstalledNodeModules(appDir);
  writeStaticAssetFixture(appDir, app);
  writeInstalledAppEnvFixture(appDir, app);
  writeInstalledAppConfigFixture(appDir, app);
  writeSafeIdleTimerDetectorFixture(appDir, app);
  writeSafeOutboundReconnectDetectorFixture(appDir, app);
  writeFileSync(join(appDir, "server.mjs"), app.serverSource(app));
  writeNodeLevel5BehaviorConfig(appDir, behaviorConfig(app));
  return appDir;
}

function writeStaticAssetFixture(appDir: string, app: InstalledThirdPartyAppDefinition): void {
  if (!app.source.endsWith("static-asset") && !app.source.endsWith("static-cache-header")) {
    return;
  }
  const publicDir = join(appDir, "public");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "message.txt"), app.body);
}

function writeInstalledAppEnvFixture(appDir: string, app: InstalledThirdPartyAppDefinition): void {
  if (!app.env) {
    return;
  }
  writeFileSync(
    join(appDir, "machinen-node-level5-env.json"),
    `${JSON.stringify(app.env, null, 2)}\n`,
  );
}

function writeInstalledAppConfigFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
): void {
  if (!app.source.endsWith("config-json-read") && !app.source.endsWith("configured-prefix")) {
    return;
  }
  const framework = app.framework;
  writeFileSync(
    join(appDir, "machinen-app-config.json"),
    `${JSON.stringify({ value: `${framework}-config`, prefix: "/configured" }, null, 2)}\n`,
  );
}

function writeSafeIdleTimerDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
): void {
  writeDetectorFixture(appDir, app, "idle-timer", { safeIdleTimer: true });
}

function writeSafeOutboundReconnectDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
): void {
  writeDetectorFixture(appDir, app, "safe-outbound-reconnect", {
    safeOutboundHttpReconnect: true,
  });
}

function writeDetectorFixture(
  appDir: string,
  app: InstalledThirdPartyAppDefinition,
  sourceSuffix: string,
  markers: Record<string, boolean>,
): void {
  if (!app.source.endsWith(sourceSuffix)) {
    return;
  }
  writeFileSync(
    join(appDir, "machinen-node-level5-detector.json"),
    `${JSON.stringify(markers, null, 2)}\n`,
  );
}

function linkInstalledNodeModules(appDir: string): void {
  const nodeModules = join(appDir, "node_modules");
  if (!existsSync(nodeModules)) {
    symlinkSync(join(nodeLevel5RealAppCorpusRepoRoot, "node_modules"), nodeModules, "dir");
  }
}

function behaviorConfig(app: InstalledThirdPartyAppDefinition): Record<string, unknown> {
  return {
    entry: "server.mjs",
    path: app.routePath,
    method: app.method ?? "GET",
    requestBody: app.requestBody,
    requestHeaders: app.requestHeaders,
    expectedStatus: app.expectedStatus ?? 200,
    expectedBody: app.body,
    expectedHeaders: {
      "x-machinen-installed-third-party-app": app.headerValue,
      ...app.expectedHeaders,
    },
  };
}

function expressHelloWorldSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressRouterSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const router = express.Router();
const port = Number(process.env.PORT ?? "0");
router.get("/42", (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.get("/", (_request, response) => response.status(200).send("installed express home"));
app.use("/users", router);
app.listen(port, "127.0.0.1");
`;
}

function expressJsonResponseSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).json(JSON.parse(${JSON.stringify(app.body)}));
});
app.listen(port, "127.0.0.1");
`;
}

function expressRouteParamsSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/users/:id", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user");
});
app.listen(port, "127.0.0.1");
`;
}

function expressQueryStringSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/search", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.query.term === "machinen" ? ${JSON.stringify(app.body)} : "wrong-query");
});
app.listen(port, "127.0.0.1");
`;
}

function expressStaticAssetSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use("/assets", (_request, response, next) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  next();
});
app.use("/assets", express.static("public"));
app.listen(port, "127.0.0.1");
`;
}

function expressIdleTimerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 25);
timer.unref();
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(ticks > 0 ? ${JSON.stringify(app.body)} : "timer-not-active");
});
app.listen(port, "127.0.0.1");
`;
}

function expressSafeOutboundReconnectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import http from "node:http";
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
const upstream = http.createServer((_request, response) => {
  response.end(${JSON.stringify(app.body)});
});
upstream.listen(0, "127.0.0.1", () => {
  const upstreamPort = upstream.address().port;
  app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
    response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
    http.get({ host: "127.0.0.1", port: upstreamPort, path: "/upstream", agent: false }, (upstreamResponse) => {
      let body = "";
      upstreamResponse.setEncoding("utf8");
      upstreamResponse.on("data", (chunk) => { body += chunk; });
      upstreamResponse.on("end", () => response.status(200).send(body));
    }).on("error", () => response.status(502).send("outbound-error"));
  });
  app.listen(port, "127.0.0.1");
});
`;
}

function expressPostJsonBodySource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use(express.json());
app.post(${JSON.stringify(app.routePath)}, (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.body.name === "machinen" ? ${JSON.stringify(app.body)} : "wrong-body");
});
app.listen(port, "127.0.0.1");
`;
}

function expressCustomHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.get("x-machinen-request") === "express-header" ? ${JSON.stringify(app.body)} : "wrong-header");
});
app.listen(port, "127.0.0.1");
`;
}

function expressPutRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.put("/items/:id", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-item");
});
app.listen(port, "127.0.0.1");
`;
}

function expressDeleteRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.delete("/items/:id", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-item");
});
app.listen(port, "127.0.0.1");
`;
}

function expressCookieReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.headers.cookie === "session=express-cookie" ? ${JSON.stringify(app.body)} : "wrong-cookie");
});
app.listen(port, "127.0.0.1");
`;
}

function expressStatusCodeSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(201).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressRedirectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.set("location", "/redirect-target");
  response.status(302).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressResponseHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.set("x-machinen-response-feature", "express-response-header");
  response.status(200).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressMiddlewareChainSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use((request, _response, next) => { request.machinenFirstMiddleware = true; next(); });
app.use((request, _response, next) => { request.machinenSecondMiddleware = request.machinenFirstMiddleware === true; next(); });
app.get(${JSON.stringify(app.routePath)}, (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.machinenSecondMiddleware === true ? ${JSON.stringify(app.body)} : "wrong-middleware");
});
app.listen(port, "127.0.0.1");
`;
}

function expressNotFoundSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/present", (_request, response) => response.status(200).send("present"));
app.use((_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(404).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressErrorHandlerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, _response, next) => next(new Error("machinen-installed-error")));
app.use((_error, _request, response, _next) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(500).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressRequestIdSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use((request, _response, next) => { request.machinenRequestId = request.get("x-request-id"); next(); });
app.get(${JSON.stringify(app.routePath)}, (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.machinenRequestId === "express-request-id" ? ${JSON.stringify(app.body)} : "wrong-request-id");
});
app.listen(port, "127.0.0.1");
`;
}

function expressNestedRouterSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const api = express.Router();
const v1 = express.Router();
const port = Number(process.env.PORT ?? "0");
v1.get("/users/:id", (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user");
});
api.use("/v1", v1);
app.use("/api", api);
app.listen(port, "127.0.0.1");
`;
}

function expressOptionalParamSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
const handler = (request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send((request.params.name ?? "fallback") === "machinen" ? ${JSON.stringify(app.body)} : "wrong-param");
};
app.get("/optional", handler);
app.get("/optional/:name", handler);
app.listen(port, "127.0.0.1");
`;
}

function expressMultiRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get("/multi/one", (_request, response) => response.status(200).send("installed express multi route one"));
app.get("/multi/two", (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function expressStaticCacheHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.use("/cached", (_request, response, next) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.set("cache-control", "public, max-age=60");
  next();
});
app.use("/cached", express.static("public"));
app.listen(port, "127.0.0.1");
`;
}

function expressEnvReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(process.env.MACHINEN_SELECTED_ENV === "express-env" ? ${JSON.stringify(app.body)} : "wrong-env");
});
app.listen(port, "127.0.0.1");
`;
}

function expressConfigJsonReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFileSync } from "node:fs";
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
const config = JSON.parse(readFileSync("machinen-app-config.json", "utf8"));
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(config.value === "express-config" ? ${JSON.stringify(app.body)} : "wrong-config");
});
app.listen(port, "127.0.0.1");
`;
}

function expressFeatureFlagEnvSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(process.env.MACHINEN_FEATURE_FLAG === "express-enabled" ? ${JSON.stringify(app.body)} : "wrong-flag");
});
app.listen(port, "127.0.0.1");
`;
}

function expressConfiguredPrefixSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFileSync } from "node:fs";
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
const config = JSON.parse(readFileSync("machinen-app-config.json", "utf8"));
app.get(config.prefix + "/status", (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(config.prefix === "/configured" ? ${JSON.stringify(app.body)} : "wrong-prefix");
});
app.listen(port, "127.0.0.1");
`;
}

function expressHealthCheckSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import express from "express";
const app = express();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, (_request, response) => {
  response.set("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  response.status(200).send(${JSON.stringify(app.body)});
});
app.listen(port, "127.0.0.1");
`;
}

function fastifyGettingStartedSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyJsonResponseSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return JSON.parse(${JSON.stringify(app.body)});
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyRouteParamsSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/users/:id", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyQueryStringSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/search", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.query.term === "machinen" ? ${JSON.stringify(app.body)} : "wrong-query";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyStaticAssetSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return await readFile("public/message.txt", "utf8");
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyIdleTimerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
let ticks = 0;
const timer = setInterval(() => { ticks += 1; }, 25);
timer.unref();
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ticks > 0 ? ${JSON.stringify(app.body)} : "timer-not-active";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifySafeOutboundReconnectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import http from "node:http";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
const upstream = http.createServer((_request, response) => {
  response.end(${JSON.stringify(app.body)});
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: upstreamPort, path: "/upstream", agent: false }, (upstreamResponse) => {
      let body = "";
      upstreamResponse.setEncoding("utf8");
      upstreamResponse.on("data", (chunk) => { body += chunk; });
      upstreamResponse.on("end", () => resolve(body));
    }).on("error", () => resolve("outbound-error"));
  });
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyPostJsonBodySource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.post(${JSON.stringify(app.routePath)}, async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.body.name === "machinen" ? ${JSON.stringify(app.body)} : "wrong-body";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyCustomHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.headers["x-machinen-request"] === "fastify-header" ? ${JSON.stringify(app.body)} : "wrong-header";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyPutRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.put("/items/:id", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-item";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyDeleteRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.delete("/items/:id", async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-item";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyCookieReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.headers.cookie === "session=fastify-cookie" ? ${JSON.stringify(app.body)} : "wrong-cookie";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyStatusCodeSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.code(201);
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyRedirectSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.header("location", "/redirect-target");
  reply.code(302);
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyResponseHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.header("x-machinen-response-feature", "fastify-response-header");
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyHookChainSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.addHook("preHandler", async (request) => { request.machinenFirstHook = true; });
server.addHook("preHandler", async (request) => { request.machinenSecondHook = request.machinenFirstHook === true; });
server.get(${JSON.stringify(app.routePath)}, async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.machinenSecondHook === true ? ${JSON.stringify(app.body)} : "wrong-hook";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyNotFoundSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/present", async () => "present");
server.setNotFoundHandler((_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.code(404).send(${JSON.stringify(app.body)});
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyErrorHandlerSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async () => { throw new Error("machinen-installed-error"); });
server.setErrorHandler((_error, _request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.code(500).send(${JSON.stringify(app.body)});
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyRequestIdSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.addHook("preHandler", async (request) => { request.machinenRequestId = request.headers["x-request-id"]; });
server.get(${JSON.stringify(app.routePath)}, async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return request.machinenRequestId === "fastify-request-id" ? ${JSON.stringify(app.body)} : "wrong-request-id";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyPrefixRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
await server.register(async (instance) => {
  instance.get("/users/:id", async (request, reply) => {
    reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
    return request.params.id === "42" ? ${JSON.stringify(app.body)} : "wrong-user";
  });
}, { prefix: "/api/v1" });
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyOptionalParamSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
const handler = async (request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return (request.params.name ?? "fallback") === "machinen" ? ${JSON.stringify(app.body)} : "wrong-param";
};
server.get("/optional", handler);
server.get("/optional/:name", handler);
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyMultiRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get("/multi/one", async () => "installed fastify multi route one");
server.get("/multi/two", async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyStaticCacheHeaderSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  reply.header("cache-control", "public, max-age=60");
  return await readFile("public/message.txt", "utf8");
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyEnvReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return process.env.MACHINEN_SELECTED_ENV === "fastify-env" ? ${JSON.stringify(app.body)} : "wrong-env";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyConfigJsonReadSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  const config = JSON.parse(await readFile("machinen-app-config.json", "utf8"));
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return config.value === "fastify-config" ? ${JSON.stringify(app.body)} : "wrong-config";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyFeatureFlagEnvSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return process.env.MACHINEN_FEATURE_FLAG === "fastify-enabled" ? ${JSON.stringify(app.body)} : "wrong-flag";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyConfiguredPrefixSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
const config = JSON.parse(await readFile("machinen-app-config.json", "utf8"));
server.get(config.prefix + "/status", async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return config.prefix === "/configured" ? ${JSON.stringify(app.body)} : "wrong-prefix";
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyHealthCheckSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
const app = Fastify();
const port = Number(process.env.PORT ?? "0");
app.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
app.listen({ port, host: "127.0.0.1" });
`;
}

function fastifyPluginRouteSource(app: InstalledThirdPartyAppDefinition): string {
  return `
import Fastify from "fastify";
import sensible from "@fastify/sensible";
const server = Fastify({ logger: false });
const port = Number(process.env.PORT ?? "0");
await server.register(sensible);
server.get(${JSON.stringify(app.routePath)}, async (_request, reply) => {
  reply.header("x-machinen-installed-third-party-app", ${JSON.stringify(app.headerValue)});
  return ${JSON.stringify(app.body)};
});
await server.listen({ port, host: "127.0.0.1" });
`;
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  return parseNodeLevel5RealAppCorpusOutArgs(
    args,
    "usage: node-level5-installed-third-party-app-corpus --out <dir> [--json]",
  );
}

if (isNodeLevel5RealAppCorpusMain(import.meta.url)) {
  main();
}
