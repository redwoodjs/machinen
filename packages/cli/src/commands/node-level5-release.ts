import {
  buildNodeLevel5AppSupportMatrix,
  nodeLevel5ProductSupport80UnsupportedDetectors,
  nodeLevel5ProductSupport85ClaimRegistry,
} from "@machinen/runtime";

import { readOptionalNodeLevel5RetainedArtifact } from "./node-level5-artifacts.ts";
import { reportNodeLevel5ProductCommand } from "./node-level5-reporting.ts";
import {
  nodeLevel5ReleaseGateArtifactArgs,
  readOptionalNodeLevel5GenericVmCorpus,
  readOptionalNodeLevel5GenericVmRefusalArtifacts,
  readOptionalNodeLevel5GenericVmRetainedEvidence,
  readOptionalNodeLevel5GenericVmRowArtifacts,
  readOptionalNodeLevel5InstalledThirdPartyAppCorpus,
  readOptionalNodeLevel5RealAppCorpus,
  readOptionalNodeLevel5RealAppRefusalCorpus,
  readOptionalNodeLevel5ThirdPartyAppCorpus,
} from "./node-level5-release-reports.ts";

export function cmdNodeLevel5Detectors(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-detector-registry-summary",
    detectors: nodeLevel5ProductSupport80UnsupportedDetectors,
    retainedArtifact: artifact,
  });
}

export function cmdNodeLevel5Claims(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    accepted: true,
    kind: "machinen.node-level5-claim-registry-summary",
    claimRegistry: nodeLevel5ProductSupport85ClaimRegistry,
    retainedArtifact: artifact,
  });
}

export function cmdNodeLevel5SupportMatrix(args: string[], json: boolean): number {
  const artifact = readOptionalNodeLevel5RetainedArtifact(args);
  return reportNodeLevel5ProductCommand(json, {
    ...buildNodeLevel5AppSupportMatrix(),
    retainedArtifact: artifact,
  });
}

export function cmdNodeLevel5ReleaseGate(args: string[], json: boolean): number {
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
