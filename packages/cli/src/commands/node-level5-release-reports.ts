import {
  evaluateNodeLevel5ProductSupport85ClaimReady,
  evaluateNodeLevel5ProductSupport85Readiness,
  loadNodeLevel5GenericVmCorpusReport,
  loadNodeLevel5GenericVmRefusalArtifactsReport,
  loadNodeLevel5GenericVmRetainedEvidenceReport,
  loadNodeLevel5GenericVmRowArtifactsReport,
  loadNodeLevel5InstalledThirdPartyAppCorpusReport,
  loadNodeLevel5ProductSupport85ReadinessReport,
  loadNodeLevel5RealAppCorpusReport,
  loadNodeLevel5RealAppRefusalCorpusReport,
  loadNodeLevel5ThirdPartyAppCorpusReport,
  verifyNodeLevel5GenericVmCorpusReport,
  verifyNodeLevel5GenericVmRefusalArtifactsReport,
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  verifyNodeLevel5GenericVmRowArtifactsReport,
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  verifyNodeLevel5RealAppCorpusReport,
  verifyNodeLevel5RealAppRefusalCorpusReport,
  verifyNodeLevel5ThirdPartyAppCorpusReport,
} from "@machinen/runtime";
import { resolve } from "node:path";

import { die } from "../errors.ts";
import {
  invalidNodeLevel5ReleaseReport,
  reportNodeLevel5ProductCommand,
} from "./node-level5-reporting.ts";

const nodeLevel5ReleaseGateReportFlags = new Set([
  "--include-real-app-corpus",
  "--include-refusal-corpus",
  "--include-third-party-app-corpus",
  "--include-installed-third-party-app-corpus",
  "--include-generic-vm-corpus",
  "--include-generic-vm-retained-evidence",
  "--include-generic-vm-row-artifacts",
  "--include-generic-vm-refusal-artifacts",
  "--corpus-report",
  "--refusal-corpus-report",
  "--third-party-app-corpus-report",
  "--installed-third-party-app-corpus-report",
  "--generic-vm-corpus-report",
  "--generic-vm-retained-evidence-report",
  "--generic-vm-row-artifacts-report",
  "--generic-vm-refusal-artifacts-report",
]);
const nodeLevel5ReleaseGateReportValueFlags = new Set([
  "--corpus-report",
  "--refusal-corpus-report",
  "--third-party-app-corpus-report",
  "--installed-third-party-app-corpus-report",
  "--generic-vm-corpus-report",
  "--generic-vm-retained-evidence-report",
  "--generic-vm-row-artifacts-report",
  "--generic-vm-refusal-artifacts-report",
]);

export function cmdNodeLevel5ProductSupport85Readiness(args: string[], json: boolean): number {
  const reportPath = requiredNodeLevel5GenericVmCorpusReportPath(args, "85-readiness");
  const retainedEvidencePath = optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args);
  const rowArtifactsPath = optionalNodeLevel5GenericVmRowArtifactsReportPath(args);
  const refusalArtifactsPath = optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args);
  const summary = evaluateNodeLevel5ProductSupport85Readiness({
    genericVmCorpusReport: loadNodeLevel5GenericVmCorpusReport(resolve(reportPath)),
    ...(retainedEvidencePath
      ? {
          genericVmRetainedEvidenceReport: loadNodeLevel5GenericVmRetainedEvidenceReport(
            resolve(retainedEvidencePath),
          ),
        }
      : {}),
    ...(rowArtifactsPath
      ? {
          genericVmRowArtifactsReport: loadNodeLevel5GenericVmRowArtifactsReport(
            resolve(rowArtifactsPath),
          ),
        }
      : {}),
    ...(refusalArtifactsPath
      ? {
          genericVmRefusalArtifactsReport: loadNodeLevel5GenericVmRefusalArtifactsReport(
            resolve(refusalArtifactsPath),
          ),
        }
      : {}),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

export function cmdNodeLevel5ProductSupport85ClaimReady(args: string[], json: boolean): number {
  const readinessPath = requiredNodeLevel5ProductSupport85ReadinessReportPath(args);
  const summary = evaluateNodeLevel5ProductSupport85ClaimReady({
    readinessReport: loadNodeLevel5ProductSupport85ReadinessReport(resolve(readinessPath)),
  });
  return reportNodeLevel5ProductCommand(json, summary);
}

function requiredNodeLevel5ProductSupport85ReadinessReportPath(args: string[]): string {
  const reportFlag = args.indexOf("--readiness-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die("machinen node-level5 85-claim-ready requires --readiness-report <file>");
  }
  return path;
}

export function nodeLevel5ReleaseGateArtifactArgs(args: string[]): string[] {
  return args.filter((arg, index) => !isNodeLevel5ReleaseGateReportArg(args, arg, index));
}

function isNodeLevel5ReleaseGateReportArg(args: string[], arg: string, index: number): boolean {
  return (
    nodeLevel5ReleaseGateReportFlags.has(arg) ||
    nodeLevel5ReleaseGateReportValueFlags.has(args[index - 1] ?? "")
  );
}

export function readOptionalNodeLevel5RealAppCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5RealAppCorpusReportPath(args);
  return path ? verifyNodeLevel5RealAppCorpusPath(path) : undefined;
}

function nodeLevel5RealAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-real-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-real-app-corpus requires --corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5RealAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5RealAppCorpusReport(loadNodeLevel5RealAppCorpusReport(resolve(path)));
  } catch (error) {
    return invalidNodeLevel5RealAppCorpus(error);
  }
}

function invalidNodeLevel5RealAppCorpus(error: unknown): Record<string, unknown> {
  return invalidNodeLevel5ReleaseReport("node-level5-real-app-corpus-invalid", error);
}

export function readOptionalNodeLevel5RealAppRefusalCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5RealAppRefusalCorpusReportPath(args);
  return path ? verifyNodeLevel5RealAppRefusalCorpusPath(path) : undefined;
}

function nodeLevel5RealAppRefusalCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-refusal-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--refusal-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-refusal-corpus requires --refusal-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5RealAppRefusalCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5RealAppRefusalCorpusReport(
      loadNodeLevel5RealAppRefusalCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-real-app-refusal-corpus-invalid", error);
  }
}

export function readOptionalNodeLevel5ThirdPartyAppCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5ThirdPartyAppCorpusReportPath(args);
  return path ? verifyNodeLevel5ThirdPartyAppCorpusPath(path) : undefined;
}

function nodeLevel5ThirdPartyAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-third-party-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--third-party-app-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-third-party-app-corpus requires --third-party-app-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5ThirdPartyAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5ThirdPartyAppCorpusReport(
      loadNodeLevel5ThirdPartyAppCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-third-party-app-corpus-invalid", error);
  }
}

export function readOptionalNodeLevel5InstalledThirdPartyAppCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5InstalledThirdPartyAppCorpusReportPath(args);
  return path ? verifyNodeLevel5InstalledThirdPartyAppCorpusPath(path) : undefined;
}

function nodeLevel5InstalledThirdPartyAppCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-installed-third-party-app-corpus")) {
    return undefined;
  }
  const reportFlag = args.indexOf("--installed-third-party-app-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(
      "machinen node-level5 release-gate --include-installed-third-party-app-corpus requires --installed-third-party-app-corpus-report <file>",
    );
  }
  return path;
}

function verifyNodeLevel5InstalledThirdPartyAppCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5InstalledThirdPartyAppCorpusReport(
      loadNodeLevel5InstalledThirdPartyAppCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-installed-third-party-app-corpus-invalid",
      error,
    );
  }
}

export function readOptionalNodeLevel5GenericVmCorpus(
  args: string[],
): Record<string, unknown> | undefined {
  const path = nodeLevel5GenericVmCorpusReportPath(args);
  return path ? verifyNodeLevel5GenericVmCorpusPath(path) : undefined;
}

function nodeLevel5GenericVmCorpusReportPath(args: string[]): string | undefined {
  if (!args.includes("--include-generic-vm-corpus")) {
    return undefined;
  }
  return requiredNodeLevel5GenericVmCorpusReportPath(
    args,
    "release-gate --include-generic-vm-corpus",
  );
}

function requiredNodeLevel5GenericVmCorpusReportPath(args: string[], command: string): string {
  const reportFlag = args.indexOf("--generic-vm-corpus-report");
  const path = reportFlag === -1 ? undefined : args[reportFlag + 1];
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-corpus-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmCorpusPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmCorpusReport(
      loadNodeLevel5GenericVmCorpusReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-generic-vm-corpus-invalid", error);
  }
}

export function readOptionalNodeLevel5GenericVmRetainedEvidence(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-retained-evidence")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRetainedEvidenceReportPath(
    args,
    "release-gate --include-generic-vm-retained-evidence",
  );
  return verifyNodeLevel5GenericVmRetainedEvidencePath(path);
}

function optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-retained-evidence-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRetainedEvidenceReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRetainedEvidenceReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-retained-evidence-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRetainedEvidencePath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRetainedEvidenceReport(
      loadNodeLevel5GenericVmRetainedEvidenceReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-generic-vm-retained-evidence-invalid",
      error,
    );
  }
}

export function readOptionalNodeLevel5GenericVmRowArtifacts(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-row-artifacts")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRowArtifactsReportPath(
    args,
    "release-gate --include-generic-vm-row-artifacts",
  );
  return verifyNodeLevel5GenericVmRowArtifactsPath(path);
}

function optionalNodeLevel5GenericVmRowArtifactsReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-row-artifacts-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRowArtifactsReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRowArtifactsReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-row-artifacts-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRowArtifactsPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRowArtifactsReport(
      loadNodeLevel5GenericVmRowArtifactsReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport("node-level5-generic-vm-row-artifacts-invalid", error);
  }
}

export function readOptionalNodeLevel5GenericVmRefusalArtifacts(
  args: string[],
): Record<string, unknown> | undefined {
  if (!args.includes("--include-generic-vm-refusal-artifacts")) {
    return undefined;
  }
  const path = requiredNodeLevel5GenericVmRefusalArtifactsReportPath(
    args,
    "release-gate --include-generic-vm-refusal-artifacts",
  );
  return verifyNodeLevel5GenericVmRefusalArtifactsPath(path);
}

function optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args: string[]): string | undefined {
  const reportFlag = args.indexOf("--generic-vm-refusal-artifacts-report");
  return reportFlag === -1 ? undefined : args[reportFlag + 1];
}

function requiredNodeLevel5GenericVmRefusalArtifactsReportPath(
  args: string[],
  command: string,
): string {
  const path = optionalNodeLevel5GenericVmRefusalArtifactsReportPath(args);
  if (!path) {
    die(`machinen node-level5 ${command} requires --generic-vm-refusal-artifacts-report <file>`);
  }
  return path;
}

function verifyNodeLevel5GenericVmRefusalArtifactsPath(path: string): Record<string, unknown> {
  try {
    return verifyNodeLevel5GenericVmRefusalArtifactsReport(
      loadNodeLevel5GenericVmRefusalArtifactsReport(resolve(path)),
    );
  } catch (error) {
    return invalidNodeLevel5ReleaseReport(
      "node-level5-generic-vm-refusal-artifacts-invalid",
      error,
    );
  }
}
