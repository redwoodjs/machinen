import {
  buildNodeLevel5AppSupportMatrix,
  createNodeLevel5DeclaredSubsetCapture,
  createNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5GenericVmCorpusReport,
  loadNodeLevel5GenericVmRefusalArtifactsReport,
  loadNodeLevel5GenericVmRetainedEvidenceReport,
  loadNodeLevel5GenericVmRowArtifactsReport,
  loadNodeLevel5InstalledThirdPartyAppCorpusReport,
  loadNodeLevel5ProductSupport80ArtifactBundle,
  loadNodeLevel5ProductSupport85ReadinessReport,
  loadNodeLevel5RealAppCorpusReport,
  loadNodeLevel5RealAppRefusalCorpusReport,
  loadNodeLevel5ThirdPartyAppCorpusReport,
  nodeLevel5ProductSupport80UnsupportedDetectors,
  nodeLevel5ProductSupport85ClaimRegistry,
  evaluateNodeLevel5ProductSupport85ClaimReady,
  evaluateNodeLevel5ProductSupport85Readiness,
  verifyNodeLevel5GenericVmCorpusReport,
  verifyNodeLevel5GenericVmRefusalArtifactsReport,
  verifyNodeLevel5GenericVmRetainedEvidenceReport,
  verifyNodeLevel5GenericVmRowArtifactsReport,
  verifyNodeLevel5InstalledThirdPartyAppCorpusReport,
  verifyNodeLevel5ProductSupport80ArtifactBundle,
  verifyNodeLevel5RealAppCorpusReport,
  verifyNodeLevel5RealAppRefusalCorpusReport,
  verifyNodeLevel5ThirdPartyAppCorpusReport,
  type NodeLevel5ProductSupport80FamilyId,
} from "@machinen/runtime";
import { resolve } from "node:path";

import { consumeDryRunFlag, consumeJsonFlag, emitJson, emitJsonError } from "../args.ts";
import { die } from "../errors.ts";

export function cmdCapture(args: string[]): number {
  const { json, rest: withoutJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(withoutJson);
  if (rest[0] === "node-level5") {
    return cmdCaptureNodeLevel5DeclaredSubset({ json, dryRun, rest });
  }
  die(captureUsage());
}

// fallow-ignore-next-line complexity code-duplication
function cmdCaptureNodeLevel5DeclaredSubset(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): number {
  const options = parseNodeLevel5DeclaredSubsetCaptureArgs(input.rest.slice(1));
  if (!options.out) {
    reportNodeLevel5DeclaredSubsetCliRefusal(
      input.json,
      "node-level5-declared-subset-output-required",
      "machinen capture node-level5 requires --out <dir>",
    );
  }
  const summary = createNodeLevel5DeclaredSubsetCapture({
    outDir: options.out,
    sourceArch: options.sourceArch,
    targetArch: options.targetArch,
    experimental: options.experimental,
    productSupportClaimed: options.productSupportClaimed,
    dryRun: input.dryRun,
  });
  return reportNodeLevel5DeclaredSubsetSummary(input.json, summary, {
    accepted: (value) => `captured experimental node-level5 manifest: ${value.manifestPath}\n`,
    refused: (value) => `refused experimental node-level5 capture: ${value.refusal?.code}\n`,
  });
}

type NodeLevel5DeclaredSubsetCliOptions = {
  out: string;
  manifest: string;
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
  experimental: boolean;
  productSupportClaimed: boolean;
  rawCpuRestore: boolean;
};

function parseNodeLevel5DeclaredSubsetCaptureArgs(
  args: string[],
): Pick<
  NodeLevel5DeclaredSubsetCliOptions,
  "out" | "sourceArch" | "targetArch" | "experimental" | "productSupportClaimed"
> {
  return parseNodeLevel5DeclaredSubsetCliArgs(args, "capture");
}

// fallow-ignore-next-line complexity
function parseNodeLevel5DeclaredSubsetCliArgs(
  args: string[],
  mode: "capture" | "restore",
): NodeLevel5DeclaredSubsetCliOptions {
  const options = defaultNodeLevel5DeclaredSubsetCliOptions();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--experimental-node-level5") {
      options.experimental = true;
    } else if (arg === "--claim-product-support") {
      options.productSupportClaimed = true;
    } else if (mode === "capture" && arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (mode === "capture" && arg === "--source-arch") {
      options.sourceArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--source-arch"),
        "--source-arch",
      );
    } else if (mode === "capture" && arg === "--target-arch") {
      options.targetArch = parseProductArch(
        takeCaptureValue(args, (index += 1), "--target-arch"),
        "--target-arch",
      );
    } else if (mode === "restore" && arg === "--raw-cpu-restore") {
      options.rawCpuRestore = true;
    } else if (mode === "restore" && arg === "--manifest") {
      options.manifest = takeCaptureValue(args, (index += 1), "--manifest");
    } else if (mode === "restore" && !arg.startsWith("-") && !options.manifest) {
      options.manifest = arg;
    } else {
      die(`unknown node-level5 ${mode} argument: ${arg}`);
    }
  }
  return options;
}

function defaultNodeLevel5DeclaredSubsetCliOptions(): NodeLevel5DeclaredSubsetCliOptions {
  return {
    out: "",
    manifest: "",
    sourceArch: "arm64",
    targetArch: "amd64",
    experimental: false,
    productSupportClaimed: false,
    rawCpuRestore: false,
  };
}

function reportNodeLevel5DeclaredSubsetCliRefusal(
  json: boolean,
  code: string,
  message: string,
): never {
  if (json) {
    emitJsonError(code, message);
  } else {
    process.stderr.write(`machinen: ${message} (${code})\n`);
  }
  process.exit(1);
}

type NodeLevel5DeclaredSubsetCliSummary = {
  accepted: boolean;
  manifestPath?: string;
  refusal?: { code: string };
};

function reportNodeLevel5DeclaredSubsetSummary<TSummary extends NodeLevel5DeclaredSubsetCliSummary>(
  json: boolean,
  summary: TSummary,
  messages: {
    accepted: (summary: TSummary) => string;
    refused: (summary: TSummary) => string;
  },
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(summary.accepted ? messages.accepted(summary) : messages.refused(summary));
  }
  return summary.accepted ? 0 : 1;
}

type NodeLevel5ArtifactCliOptions = {
  out?: string;
  root?: string;
  family?: NodeLevel5ProductSupport80FamilyId;
  direction?: "arm64-to-amd64" | "amd64-to-arm64";
};

// fallow-ignore-next-line complexity
export function cmdNodeLevel5(args: string[]): number {
  const { json, rest } = consumeJsonFlag(args);
  if (rest[0] === "artifacts") {
    return cmdNodeLevel5Artifacts(rest.slice(1), json);
  }
  if (rest[0] === "detectors") {
    return cmdNodeLevel5Detectors(rest.slice(1), json);
  }
  if (rest[0] === "claims") {
    return cmdNodeLevel5Claims(rest.slice(1), json);
  }
  if (rest[0] === "support-matrix") {
    return cmdNodeLevel5SupportMatrix(rest.slice(1), json);
  }
  if (rest[0] === "release-gate") {
    return cmdNodeLevel5ReleaseGate(rest.slice(1), json);
  }
  if (rest[0] === "85-readiness") {
    return cmdNodeLevel5ProductSupport85Readiness(rest.slice(1), json);
  }
  if (rest[0] === "85-claim-ready") {
    return cmdNodeLevel5ProductSupport85ClaimReady(rest.slice(1), json);
  }
  if (rest[0] === "abi-check") {
    return cmdNodeLevel5AbiCheck(rest.slice(1), json);
  }
  die(nodeLevel5Usage());
}

// fallow-ignore-next-line complexity
function cmdNodeLevel5Artifacts(args: string[], json: boolean): number {
  const [sub, ...rest] = args;
  const options = parseNodeLevel5ArtifactArgs(rest);
  if (sub === "write") {
    if (!options.out || !options.family || !options.direction) {
      die("machinen node-level5 artifacts write requires --out, --family, and --direction");
    }
    const bundle = createNodeLevel5ProductSupport80ArtifactBundle({
      outDir: resolve(options.out),
      familyId: options.family,
      direction: options.direction,
    });
    return reportNodeLevel5ProductCommand(json, { accepted: true, bundle });
  }
  if (sub === "verify") {
    if (!options.root || !options.family || !options.direction) {
      die("machinen node-level5 artifacts verify requires --root, --family, and --direction");
    }
    try {
      assertSafeNodeLevel5ArtifactRootPath(options.root);
      return reportNodeLevel5ProductCommand(
        json,
        verifyNodeLevel5RetainedArtifact({
          root: options.root,
          family: options.family,
          direction: options.direction,
        }),
      );
    } catch (error) {
      return reportNodeLevel5ProductCommand(json, {
        accepted: false,
        code: "node-level5-artifact-bundle-invalid",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  die(nodeLevel5Usage());
}

function cmdNodeLevel5Detectors(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-detector-registry-summary",
    detectors: nodeLevel5ProductSupport80UnsupportedDetectors,
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5Claims(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-claim-registry-summary",
    claimRegistry: nodeLevel5ProductSupport85ClaimRegistry,
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5SupportMatrix(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    ...buildNodeLevel5AppSupportMatrix(),
    retainedArtifact: artifact,
  });
}

function cmdNodeLevel5ReleaseGate(args: string[], json: boolean): number {
  const corpus = readOptionalNodeLevel5RealAppCorpus(args);
  const refusalCorpus = readOptionalNodeLevel5RealAppRefusalCorpus(args);
  const thirdPartyAppCorpus = readOptionalNodeLevel5ThirdPartyAppCorpus(args);
  const installedThirdPartyAppCorpus = readOptionalNodeLevel5InstalledThirdPartyAppCorpus(args);
  const genericVmCorpus = readOptionalNodeLevel5GenericVmCorpus(args);
  const genericVmRetainedEvidence = readOptionalNodeLevel5GenericVmRetainedEvidence(args);
  const genericVmRowArtifacts = readOptionalNodeLevel5GenericVmRowArtifacts(args);
  const genericVmRefusalArtifacts = readOptionalNodeLevel5GenericVmRefusalArtifacts(args);
  const artifact = readOptionalNodeLevel5RetainedArtifact(nodeLevel5ReleaseGateArtifactArgs(args));
  const accepted = [
    artifact,
    corpus,
    refusalCorpus,
    thirdPartyAppCorpus,
    installedThirdPartyAppCorpus,
    genericVmCorpus,
    genericVmRetainedEvidence,
    genericVmRowArtifacts,
    genericVmRefusalArtifacts,
  ].every((item) => (item ? item.accepted === true : true));
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-release-gate-summary",
    nodeProductSupportClaimed: 85,
    broadNodeProductSupportClaimed: 25,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    retainedArtifact: artifact,
    realAppCorpus: corpus,
    realAppRefusalCorpus: refusalCorpus,
    thirdPartyAppCorpus,
    installedThirdPartyAppCorpus,
    genericVmCorpus,
    genericVmRetainedEvidence,
    genericVmRowArtifacts,
    genericVmRefusalArtifacts,
  });
}

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

function cmdNodeLevel5ProductSupport85Readiness(args: string[], json: boolean): number {
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

function cmdNodeLevel5ProductSupport85ClaimReady(args: string[], json: boolean): number {
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

function nodeLevel5ReleaseGateArtifactArgs(args: string[]): string[] {
  return args.filter((arg, index) => !isNodeLevel5ReleaseGateReportArg(args, arg, index));
}

function isNodeLevel5ReleaseGateReportArg(args: string[], arg: string, index: number): boolean {
  return (
    nodeLevel5ReleaseGateReportFlags.has(arg) ||
    nodeLevel5ReleaseGateReportValueFlags.has(args[index - 1] ?? "")
  );
}

function readOptionalNodeLevel5RealAppCorpus(args: string[]): Record<string, unknown> | undefined {
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

function readOptionalNodeLevel5RealAppRefusalCorpus(
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

function readOptionalNodeLevel5ThirdPartyAppCorpus(
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

function readOptionalNodeLevel5InstalledThirdPartyAppCorpus(
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

function readOptionalNodeLevel5GenericVmCorpus(
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

function readOptionalNodeLevel5GenericVmRetainedEvidence(
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

function readOptionalNodeLevel5GenericVmRowArtifacts(
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

function readOptionalNodeLevel5GenericVmRefusalArtifacts(
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

function invalidNodeLevel5ReleaseReport(code: string, error: unknown): Record<string, unknown> {
  return {
    accepted: false,
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

// fallow-ignore-next-line complexity
function readOptionalNodeLevel5RetainedArtifact(
  args: string[],
): Record<string, unknown> | undefined {
  if (args.length === 0) {
    return undefined;
  }
  try {
    const options = parseNodeLevel5ArtifactArgs(args);
    if (!options.root || !options.family || !options.direction) {
      die(
        "machinen node-level5 retained artifact commands require --root, --family, and --direction",
      );
    }
    assertSafeNodeLevel5ArtifactRootPath(options.root);
    return verifyNodeLevel5RetainedArtifact({
      root: options.root,
      family: options.family,
      direction: options.direction,
    });
  } catch (error) {
    return {
      accepted: false,
      code: "node-level5-artifact-bundle-invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyNodeLevel5RetainedArtifact(
  options: Required<Pick<NodeLevel5ArtifactCliOptions, "root" | "family" | "direction">>,
): Record<string, unknown> {
  const bundle = loadNodeLevel5ProductSupport80ArtifactBundle({
    artifactRoot: resolve(options.root),
    familyId: options.family,
    direction: options.direction,
  });
  return verifyNodeLevel5ProductSupport80ArtifactBundle(bundle);
}

function assertSafeNodeLevel5ArtifactRootPath(path: string): void {
  if (path.split(/[\\/]+/u).includes("..")) {
    throw new Error("Node Level 5 artifact root must not contain path traversal segments");
  }
}

// fallow-ignore-next-line complexity
function parseNodeLevel5ArtifactArgs(args: string[]): NodeLevel5ArtifactCliOptions {
  const options: NodeLevel5ArtifactCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--out") {
      options.out = takeCaptureValue(args, (index += 1), "--out");
    } else if (arg === "--root") {
      options.root = takeCaptureValue(args, (index += 1), "--root");
    } else if (arg === "--family") {
      options.family = takeCaptureValue(
        args,
        (index += 1),
        "--family",
      ) as NodeLevel5ProductSupport80FamilyId;
    } else if (arg === "--direction") {
      options.direction = takeCaptureValue(args, (index += 1), "--direction") as
        | "arm64-to-amd64"
        | "amd64-to-arm64";
    } else {
      die(`unknown node-level5 artifact argument: ${arg}`);
    }
  }
  return options;
}

// fallow-ignore-next-line complexity
function cmdNodeLevel5AbiCheck(args: string[], json: boolean): number {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index]!, args[index + 1] ?? "");
  }
  const accepted =
    values.get("--node") === "22.x" &&
    values.get("--v8") === "12.x pointer-compressed" &&
    values.get("--libuv") === "supported idle handles plus selected hard-facility boundaries";
  return reportNodeLevel5ProductCommand(json, {
    accepted,
    kind: "machinen.node-level5-abi-check-summary",
    refusal: accepted ? undefined : { code: "node-level5-unknown-abi-refused" },
  });
}

function reportNodeLevel5ProductCommand(json: boolean, summary: Record<string, unknown>): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(`${summary.accepted ? "accepted" : "refused"} node-level5 command\n`);
  }
  return summary.accepted === false ? 1 : 0;
}

function nodeLevel5Usage(): string {
  return (
    "usage: machinen node-level5 artifacts <write|verify> ... [--json]\n" +
    "       machinen node-level5 support-matrix [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-corpus --generic-vm-corpus-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-retained-evidence --generic-vm-retained-evidence-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-row-artifacts --generic-vm-row-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-refusal-artifacts --generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-readiness --generic-vm-corpus-report <file> [--generic-vm-retained-evidence-report <file>] [--generic-vm-row-artifacts-report <file>] [--generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-claim-ready --readiness-report <file> [--json]\n"
  );
}

function captureUsage(): string {
  return (
    "usage: machinen capture node-level5 --out <dir> " +
    "[--source-arch <arm64|amd64>] [--target-arch <arm64|amd64>] " +
    "[--experimental-node-level5] [--claim-product-support] [--json] [--dry-run]"
  );
}
function takeCaptureValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    die(`${flag} requires a value`);
  }
  return value;
}

function parseProductArch(value: string, flag: string): "arm64" | "amd64" {
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  die(`${flag} must be arm64 or amd64`);
}

// fallow-ignore-next-line complexity code-duplication
