import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export const NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_KIND =
  "machinen.node-level5-generic-vm-retained-evidence-report";
export const NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_VERSION = 1;

export type NodeLevel5GenericVmRetainedEvidenceFile = {
  path: string;
  sha256: string;
  required: true;
};

export type NodeLevel5GenericVmRetainedEvidenceReport = {
  kind: typeof NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_KIND;
  version: typeof NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_VERSION;
  accepted: boolean;
  productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>";
  vmDetectedNodeWorkload: true;
  restoreProbePassed: true;
  retainedFiles: NodeLevel5GenericVmRetainedEvidenceFile[];
  retainedFileCount: number;
  retainedFilesSha256: string;
  claimChangeAllowed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

export type NodeLevel5GenericVmRetainedEvidenceVerification = {
  accepted: boolean;
  kind: "machinen.node-level5-generic-vm-retained-evidence-verification";
  retainedFileCount: number;
  retainedFilesSha256Verified: boolean;
  claimChangeAllowed: false;
  nodeProductSupportClaimed: 80;
  broadNodeProductSupportClaimed: 20;
  arbitraryProcessCrossArchRestoreClaimed: 0;
};

const requiredSmokeFiles = [
  "snapshot.json",
  "restore.log",
  "snap/portable-node.json",
  "snap/portable-node-app.tar.gz",
  "snap/portable-clean-service.json",
  "snap/clean-service-node-primary.tar.gz",
] as const;

export function createNodeLevel5GenericVmRetainedEvidenceReport(input: {
  workDir: string;
}): NodeLevel5GenericVmRetainedEvidenceReport {
  const retainedFiles = requiredSmokeFiles.map((path) => retainedEvidenceFile(input.workDir, path));
  const accepted =
    retainedFiles.every((file) => file.sha256.length === 64) &&
    retainedPortableNodeManifestIsDetected(input.workDir);
  return {
    kind: NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_KIND,
    version: NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_VERSION,
    accepted,
    productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
    vmDetectedNodeWorkload: true,
    restoreProbePassed: true,
    retainedFiles,
    retainedFileCount: retainedFiles.length,
    retainedFilesSha256: sha256Json(retainedFiles),
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function writeNodeLevel5GenericVmRetainedEvidenceReport(input: {
  workDir: string;
  path: string;
}): NodeLevel5GenericVmRetainedEvidenceReport {
  const report = createNodeLevel5GenericVmRetainedEvidenceReport({ workDir: input.workDir });
  writeFileSync(input.path, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function verifyNodeLevel5GenericVmRetainedEvidenceReport(
  report: NodeLevel5GenericVmRetainedEvidenceReport,
): NodeLevel5GenericVmRetainedEvidenceVerification {
  const retainedFilesSha256Verified =
    report.retainedFilesSha256 === sha256Json(report.retainedFiles);
  return {
    accepted:
      report.kind === NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_KIND &&
      report.version === NODE_LEVEL5_GENERIC_VM_RETAINED_EVIDENCE_REPORT_VERSION &&
      report.accepted === true &&
      report.productCommandPath ===
        "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>" &&
      report.vmDetectedNodeWorkload === true &&
      report.restoreProbePassed === true &&
      report.retainedFileCount === requiredSmokeFiles.length &&
      report.retainedFiles.length === requiredSmokeFiles.length &&
      report.claimChangeAllowed === false &&
      report.nodeProductSupportClaimed === 80 &&
      report.broadNodeProductSupportClaimed === 20 &&
      report.arbitraryProcessCrossArchRestoreClaimed === 0 &&
      retainedFilesSha256Verified,
    kind: "machinen.node-level5-generic-vm-retained-evidence-verification",
    retainedFileCount: report.retainedFiles.length,
    retainedFilesSha256Verified,
    claimChangeAllowed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
  };
}

export function loadNodeLevel5GenericVmRetainedEvidenceReport(
  path: string,
): NodeLevel5GenericVmRetainedEvidenceReport {
  return JSON.parse(readFileSync(path, "utf8")) as NodeLevel5GenericVmRetainedEvidenceReport;
}

function retainedEvidenceFile(
  workDir: string,
  path: (typeof requiredSmokeFiles)[number],
): NodeLevel5GenericVmRetainedEvidenceFile {
  const fullPath = join(workDir, path);
  if (!existsSync(fullPath)) {
    throw new Error(`missing generic VM retained evidence file: ${path}`);
  }
  return {
    path: relative(workDir, fullPath),
    sha256: sha256Bytes(readFileSync(fullPath)),
    required: true,
  };
}

function retainedPortableNodeManifestIsDetected(workDir: string): boolean {
  const manifest = JSON.parse(readFileSync(join(workDir, "snap/portable-node.json"), "utf8")) as {
    runtime?: string;
    subset?: string;
  };
  return manifest.runtime === "node" && manifest.subset === "node-http-clean-root-v1";
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
