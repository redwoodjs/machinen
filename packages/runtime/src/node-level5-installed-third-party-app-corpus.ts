import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  isNodeLevel5CorpusHttpEvidenceAccepted,
  type NodeLevel5CorpusHttpEvidence,
} from "./node-level5-corpus-common.ts";
import type { NodeLevel5ProductSnapshotDirection } from "./node-level5-product-snapshot.ts";
import type { NodeLevel5RealAppCorpusFramework } from "./node-level5-real-app-corpus.ts";

export const NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_KIND =
  "machinen.node-level5-installed-third-party-app-corpus-report";
export const NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_VERSION = 1;

export type NodeLevel5InstalledThirdPartyAppSource =
  | "express-installed-hello-world"
  | "express-installed-router"
  | "express-installed-json-response"
  | "express-installed-route-params"
  | "express-installed-query-string"
  | "express-installed-static-asset"
  | "express-installed-idle-timer"
  | "express-installed-safe-outbound-reconnect"
  | "express-installed-post-json-body"
  | "express-installed-custom-header"
  | "express-installed-put-route"
  | "express-installed-delete-route"
  | "express-installed-cookie-read"
  | "express-installed-status-code"
  | "express-installed-redirect"
  | "express-installed-response-header"
  | "express-installed-middleware-chain"
  | "express-installed-not-found"
  | "express-installed-error-handler"
  | "express-installed-request-id"
  | "express-installed-nested-router"
  | "express-installed-optional-param"
  | "express-installed-multi-route"
  | "express-installed-static-cache-header"
  | "express-installed-env-read"
  | "express-installed-config-json-read"
  | "express-installed-feature-flag-env"
  | "express-installed-configured-prefix"
  | "express-installed-health-check"
  | "fastify-installed-getting-started"
  | "fastify-installed-plugin-route"
  | "fastify-installed-json-response"
  | "fastify-installed-route-params"
  | "fastify-installed-query-string"
  | "fastify-installed-static-asset"
  | "fastify-installed-idle-timer"
  | "fastify-installed-safe-outbound-reconnect"
  | "fastify-installed-post-json-body"
  | "fastify-installed-custom-header"
  | "fastify-installed-put-route"
  | "fastify-installed-delete-route"
  | "fastify-installed-cookie-read"
  | "fastify-installed-status-code"
  | "fastify-installed-redirect"
  | "fastify-installed-response-header"
  | "fastify-installed-hook-chain"
  | "fastify-installed-not-found"
  | "fastify-installed-error-handler"
  | "fastify-installed-request-id"
  | "fastify-installed-prefix-route"
  | "fastify-installed-optional-param"
  | "fastify-installed-multi-route"
  | "fastify-installed-static-cache-header"
  | "fastify-installed-env-read"
  | "fastify-installed-config-json-read"
  | "fastify-installed-feature-flag-env"
  | "fastify-installed-configured-prefix"
  | "fastify-installed-health-check";

export type NodeLevel5InstalledThirdPartyAppCorpusRow = NodeLevel5CorpusHttpEvidence & {
  appName: string;
  source: NodeLevel5InstalledThirdPartyAppSource;
  framework: NodeLevel5RealAppCorpusFramework;
  direction: NodeLevel5ProductSnapshotDirection;
  installedPackage: string;
  installedPackageVersion: string;
  declaredSubset: true;
  unsupportedStateDetected: false;
};

export type NodeLevel5InstalledThirdPartyAppCorpusReport = {
  kind: typeof NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_KIND;
  version: typeof NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_VERSION;
  accepted: boolean;
  rowCount: number;
  rowsSha256: string;
  rows: NodeLevel5InstalledThirdPartyAppCorpusRow[];
  harnessProof: true;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5InstalledThirdPartyAppCorpusVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-installed-third-party-app-corpus-verification";
  rowCount: number;
  rowsSha256Verified: boolean;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export function createNodeLevel5InstalledThirdPartyAppCorpusReport(
  rows: NodeLevel5InstalledThirdPartyAppCorpusRow[],
): NodeLevel5InstalledThirdPartyAppCorpusReport {
  return {
    kind: NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_KIND,
    version: NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_VERSION,
    accepted: rows.every(isAcceptedInstalledThirdPartyAppCorpusRow),
    rowCount: rows.length,
    rowsSha256: sha256Json(rows),
    rows,
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5InstalledThirdPartyAppCorpusReport(input: {
  path: string;
  rows: NodeLevel5InstalledThirdPartyAppCorpusRow[];
}): NodeLevel5InstalledThirdPartyAppCorpusReport {
  const report = createNodeLevel5InstalledThirdPartyAppCorpusReport(input.rows);
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5InstalledThirdPartyAppCorpusReport(
  report: NodeLevel5InstalledThirdPartyAppCorpusReport,
): NodeLevel5InstalledThirdPartyAppCorpusVerification {
  const rowsSha256Verified = report.rowsSha256 === sha256Json(report.rows);
  return {
    accepted:
      report.kind === NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_KIND &&
      report.version === NODE_LEVEL5_INSTALLED_THIRD_PARTY_APP_CORPUS_REPORT_VERSION &&
      report.accepted === true &&
      report.harnessProof === true &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      rowsSha256Verified,
    kind: "machinen.node-level5-installed-third-party-app-corpus-verification",
    rowCount: report.rows.length,
    rowsSha256Verified,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5InstalledThirdPartyAppCorpusReport(
  path: string,
): NodeLevel5InstalledThirdPartyAppCorpusReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5InstalledThirdPartyAppCorpusReport;
}

function isAcceptedInstalledThirdPartyAppCorpusRow(
  row: NodeLevel5InstalledThirdPartyAppCorpusRow,
): boolean {
  return (
    isNodeLevel5CorpusHttpEvidenceAccepted(row) &&
    Boolean(row.installedPackage) &&
    Boolean(row.installedPackageVersion) &&
    row.declaredSubset === true &&
    row.unsupportedStateDetected === false
  );
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
