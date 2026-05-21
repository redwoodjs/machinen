/** Target-native resume landing provenance and instruction-boundary audit. */

import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeRealUtilityResolvedLocation } from "./native-real-utility-code-map.ts";
import type { NativeTargetModuleByteMaterialization } from "./native-target-module-bytes.ts";
import type {
  NativeTargetUnwindFrameMatch,
  NativeTargetUnwindFrameRule,
} from "./native-target-unwind.ts";

export type NativeTargetLandingInstructionBoundaryState =
  | "known-valid"
  | "known-invalid"
  | "unknown";

export interface NativeTargetLandingModuleProvenance {
  id: string;
  logicalName: string;
  path: string;
  buildId: string;
  loadBias: string;
}

export interface NativeTargetLandingSectionProvenance {
  name: string;
  addressStart: string;
  addressEnd: string;
  fileOffsetStart: string;
  fileOffsetEnd: string;
  flags: string;
  executable: boolean;
  match: "address" | "file-offset";
}

export interface NativeTargetLandingSymbolProvenance {
  name: string;
  address: string;
  offset: string;
  sizeBytes?: number;
  type: string;
  binding: string;
  containsLanding: boolean;
}

export interface NativeTargetLandingFdeProvenance {
  id: string;
  functionName: string;
  pcStart: string;
  pcEnd: string;
  metadata: NativeTargetUnwindFrameRule["metadata"];
}

export interface NativeTargetLandingDisassemblyProvenance {
  tool: "objdump";
  addressStart?: string;
  addressEnd?: string;
  lines: string[];
  entryLine?: string;
  previousLine?: string;
  nextLine?: string;
}

export interface NativeTargetLandingInstructionBoundary {
  state: NativeTargetLandingInstructionBoundaryState;
  reason: string;
}

export interface NativeTargetResumeLandingProvenance {
  id: string;
  threadId: string;
  sourceAddress: string;
  sourceRva: string;
  targetRva: string;
  targetAddress: string;
  targetRelativeAddress: string;
  continuationStrategy: NativeRealUtilityResolvedLocation["continuationStrategy"];
  semanticContinuation?: NativeRealUtilityResolvedLocation["semanticContinuation"];
  syntheticContinuation?: NativeRealUtilityResolvedLocation["syntheticContinuation"];
  targetFileOffset?: number;
  targetInstructionBytes?: string;
  targetModule: NativeTargetLandingModuleProvenance;
  section?: NativeTargetLandingSectionProvenance;
  symbol?: NativeTargetLandingSymbolProvenance;
  fde?: NativeTargetLandingFdeProvenance;
  disassembly?: NativeTargetLandingDisassemblyProvenance;
  instructionBoundary: NativeTargetLandingInstructionBoundary;
  refusal?: NativeProcessImageRefusal;
}

export interface NativeTargetResumeLandingInspectionRequest {
  location: NativeRealUtilityResolvedLocation;
  targetBytes?: NativeTargetModuleByteMaterialization;
  targetUnwindMatches?: NativeTargetUnwindFrameMatch[];
  readelfSections?: string;
  readelfSymbols?: string;
  objdumpDisassembly?: string;
  disassemblyAddressStart?: string;
  disassemblyAddressEnd?: string;
}

interface ParsedSection {
  name: string;
  addressStart: bigint;
  addressEnd: bigint;
  fileOffsetStart: bigint;
  fileOffsetEnd: bigint;
  flags: string;
}

interface ParsedSymbol {
  name: string;
  address: bigint;
  sizeBytes: number;
  type: string;
  binding: string;
}

interface ParsedInstructionLine {
  address: bigint;
  line: string;
}

export function inspectNativeTargetResumeLanding(
  request: NativeTargetResumeLandingInspectionRequest,
): NativeTargetResumeLandingProvenance {
  const targetAddress = BigInt(request.location.targetAddress);
  const targetRelativeAddress = targetAddress - BigInt(request.location.targetModule.loadBias);
  const sections = parseReadelfSections(request.readelfSections ?? "");
  const section = targetSection(sections, targetRelativeAddress, request.targetBytes?.fileOffset);
  const symbols = parseReadelfSymbols(request.readelfSymbols ?? "");
  const symbol = targetSymbol(symbols, targetRelativeAddress);
  const fde = targetFde(request.targetUnwindMatches ?? [], request.location.targetAddress);
  const disassembly = targetDisassembly(
    request.objdumpDisassembly ?? "",
    targetRelativeAddress,
    request.disassemblyAddressStart,
    request.disassemblyAddressEnd,
  );
  const instructionBoundary = classifyInstructionBoundary({
    targetRelativeAddress,
    section,
    hasSectionMetadata: sections.length > 0,
    fde,
    disassembly,
  });
  const provenance: NativeTargetResumeLandingProvenance = {
    id: `target-resume-landing:${request.location.threadId}`,
    threadId: request.location.threadId,
    sourceAddress: request.location.codeLocation.sourceAddress,
    sourceRva: request.location.sourceRva,
    targetRva: request.location.targetRva,
    targetAddress: request.location.targetAddress,
    targetRelativeAddress: hex(targetRelativeAddress),
    continuationStrategy: request.location.continuationStrategy,
    semanticContinuation: request.location.semanticContinuation,
    syntheticContinuation: request.location.syntheticContinuation,
    targetFileOffset: request.targetBytes?.fileOffset,
    targetInstructionBytes: request.targetBytes
      ? bytesHex(request.targetBytes.bytes, 16)
      : undefined,
    targetModule: {
      id: request.location.targetModule.id,
      logicalName: request.location.targetModule.logicalName,
      path: request.location.targetModule.path,
      buildId: request.location.targetModule.buildId,
      loadBias: request.location.targetModule.loadBias,
    },
    section: section ? sectionProvenance(section) : undefined,
    symbol: symbol ? symbolProvenance(symbol, targetRelativeAddress) : undefined,
    fde: fde ? fdeProvenance(fde.targetRule) : undefined,
    disassembly,
    instructionBoundary,
  };
  if (instructionBoundary.state === "known-invalid") {
    provenance.refusal = invalidLandingRefusal(provenance);
  }
  return provenance;
}

export function nativeTargetResumeLandingRefusals(
  provenances: NativeTargetResumeLandingProvenance[],
): NativeProcessImageRefusal[] {
  return provenances.flatMap((provenance) => (provenance.refusal ? [provenance.refusal] : []));
}

function parseReadelfSections(stdout: string): ParsedSection[] {
  return stdout
    .split(/\r?\n/)
    .flatMap((line): ParsedSection[] => {
      const match =
        /^\s*\[\s*\d+\]\s+(\S+)\s+\S+\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+\S+\s+(\S*)/.exec(
          line,
        );
      if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
        return [];
      }
      const addressStart = BigInt(`0x${match[2]}`);
      const fileOffsetStart = BigInt(`0x${match[3]}`);
      const size = BigInt(`0x${match[4]}`);
      return [
        {
          name: match[1],
          addressStart,
          addressEnd: addressStart + size,
          fileOffsetStart,
          fileOffsetEnd: fileOffsetStart + size,
          flags: match[5] ?? "",
        },
      ];
    })
    .filter((section) => section.addressEnd > section.addressStart);
}

function parseReadelfSymbols(stdout: string): ParsedSymbol[] {
  return stdout.split(/\r?\n/).flatMap((line): ParsedSymbol[] => {
    const match = /^\s*\d+:\s+([0-9a-fA-F]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+\S+\s+\S+\s+(.+?)\s*$/.exec(
      line,
    );
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
      return [];
    }
    const address = BigInt(`0x${match[1]}`);
    if (address === 0n || match[5] === "UND") {
      return [];
    }
    return [
      {
        address,
        sizeBytes: Number.parseInt(match[2], 10),
        type: match[3],
        binding: match[4],
        name: match[5],
      },
    ];
  });
}

function targetSection(
  sections: ParsedSection[],
  targetRelativeAddress: bigint,
  fileOffset: number | undefined,
): (ParsedSection & { match: "address" | "file-offset" }) | undefined {
  const byAddress = sections.find(
    (section) =>
      targetRelativeAddress >= section.addressStart && targetRelativeAddress < section.addressEnd,
  );
  if (byAddress) {
    return { ...byAddress, match: "address" };
  }
  if (fileOffset === undefined) {
    return undefined;
  }
  const offset = BigInt(fileOffset);
  const byOffset = sections.find(
    (section) => offset >= section.fileOffsetStart && offset < section.fileOffsetEnd,
  );
  return byOffset ? { ...byOffset, match: "file-offset" } : undefined;
}

function targetSymbol(
  symbols: ParsedSymbol[],
  targetRelativeAddress: bigint,
): ParsedSymbol | undefined {
  const containing = symbols
    .filter(
      (symbol) =>
        symbol.type === "FUNC" &&
        symbol.sizeBytes > 0 &&
        targetRelativeAddress >= symbol.address &&
        targetRelativeAddress < symbol.address + BigInt(symbol.sizeBytes),
    )
    .sort((left, right) => Number(right.address - left.address))[0];
  if (containing) {
    return containing;
  }
  return symbols
    .filter((symbol) => symbol.type === "FUNC" && symbol.address <= targetRelativeAddress)
    .sort((left, right) => Number(right.address - left.address))[0];
}

function targetFde(
  matches: NativeTargetUnwindFrameMatch[],
  targetAddress: string,
): NativeTargetUnwindFrameMatch | undefined {
  const address = BigInt(targetAddress);
  return matches.find(
    (match) =>
      address >= BigInt(match.targetRule.pcStart) && address < BigInt(match.targetRule.pcEnd),
  );
}

function targetDisassembly(
  stdout: string,
  targetRelativeAddress: bigint,
  addressStart: string | undefined,
  addressEnd: string | undefined,
): NativeTargetLandingDisassemblyProvenance | undefined {
  if (!stdout.trim()) {
    return undefined;
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const instructions = parseObjdumpInstructionLines(lines);
  const entry = instructions.find((instruction) => instruction.address === targetRelativeAddress);
  const previous = instructions
    .filter((instruction) => instruction.address < targetRelativeAddress)
    .sort((left, right) => Number(right.address - left.address))[0];
  const next = instructions
    .filter((instruction) => instruction.address > targetRelativeAddress)
    .sort((left, right) => Number(left.address - right.address))[0];
  return {
    tool: "objdump",
    addressStart,
    addressEnd,
    lines: focusDisassemblyLines(lines, entry?.line, previous?.line, next?.line),
    entryLine: entry?.line,
    previousLine: previous?.line,
    nextLine: next?.line,
  };
}

function parseObjdumpInstructionLines(lines: string[]): ParsedInstructionLine[] {
  return lines.flatMap((line): ParsedInstructionLine[] => {
    const match = /^\s*([0-9a-fA-F]+):\s+/.exec(line);
    return match?.[1] ? [{ address: BigInt(`0x${match[1]}`), line: line.trim() }] : [];
  });
}

function focusDisassemblyLines(
  lines: string[],
  entryLine: string | undefined,
  previousLine: string | undefined,
  nextLine: string | undefined,
): string[] {
  const anchors = new Set(
    [entryLine, previousLine, nextLine].filter((line): line is string => !!line),
  );
  if (anchors.size === 0) {
    return lines.slice(0, 24);
  }
  const indices = lines.flatMap((line, index) => (anchors.has(line.trim()) ? [index] : []));
  const first = Math.max(0, Math.min(...indices) - 4);
  const last = Math.min(lines.length, Math.max(...indices) + 5);
  return lines.slice(first, last);
}

interface InstructionBoundaryClassificationInput {
  targetRelativeAddress: bigint;
  section: (ParsedSection & { match: "address" | "file-offset" }) | undefined;
  hasSectionMetadata: boolean;
  fde: NativeTargetUnwindFrameMatch | undefined;
  disassembly: NativeTargetLandingDisassemblyProvenance | undefined;
}

function classifyInstructionBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary {
  return (
    nonExecutableSectionBoundary(options) ??
    missingSectionBoundary(options) ??
    exactDisassemblyBoundary(options) ??
    interiorDisassemblyBoundary(options) ??
    unknownInstructionBoundary(options)
  );
}

function nonExecutableSectionBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary | undefined {
  if (!options.section || options.section.flags.includes("X")) {
    return undefined;
  }
  return {
    state: "known-invalid",
    reason: `target relative address ${hex(options.targetRelativeAddress)} is in non-executable section ${options.section.name}`,
  };
}

function missingSectionBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary | undefined {
  if (options.section || !options.hasSectionMetadata) {
    return undefined;
  }
  return {
    state: "known-invalid",
    reason: `target relative address ${hex(options.targetRelativeAddress)} is not inside a target ELF section`,
  };
}

function exactDisassemblyBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary | undefined {
  if (!options.fde || !options.disassembly?.entryLine) {
    return undefined;
  }
  return {
    state: "known-valid",
    reason: `objdump reports an instruction boundary at ${hex(options.targetRelativeAddress)} when decoded from the covering FDE`,
  };
}

function interiorDisassemblyBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary | undefined {
  if (!options.fde || !options.disassembly?.previousLine || !options.disassembly.nextLine) {
    return undefined;
  }
  return {
    state: "known-invalid",
    reason: `target relative address ${hex(options.targetRelativeAddress)} is between decoded amd64 instruction boundaries ${options.disassembly.previousLine} and ${options.disassembly.nextLine}`,
  };
}

function unknownInstructionBoundary(
  options: InstructionBoundaryClassificationInput,
): NativeTargetLandingInstructionBoundary {
  return {
    state: "unknown",
    reason: `insufficient target disassembly metadata to prove instruction boundary ${hex(options.targetRelativeAddress)}`,
  };
}

function sectionProvenance(
  section: ParsedSection & { match: "address" | "file-offset" },
): NativeTargetLandingSectionProvenance {
  return {
    name: section.name,
    addressStart: hex(section.addressStart),
    addressEnd: hex(section.addressEnd),
    fileOffsetStart: hex(section.fileOffsetStart),
    fileOffsetEnd: hex(section.fileOffsetEnd),
    flags: section.flags,
    executable: section.flags.includes("X"),
    match: section.match,
  };
}

function symbolProvenance(
  symbol: ParsedSymbol,
  targetRelativeAddress: bigint,
): NativeTargetLandingSymbolProvenance {
  const offset = targetRelativeAddress - symbol.address;
  const containsLanding = symbol.sizeBytes > 0 && offset >= 0n && offset < BigInt(symbol.sizeBytes);
  return {
    name: symbol.name,
    address: hex(symbol.address),
    offset: hex(offset),
    sizeBytes: symbol.sizeBytes || undefined,
    type: symbol.type,
    binding: symbol.binding,
    containsLanding,
  };
}

function fdeProvenance(rule: NativeTargetUnwindFrameRule): NativeTargetLandingFdeProvenance {
  return {
    id: rule.id,
    functionName: rule.functionName,
    pcStart: rule.pcStart,
    pcEnd: rule.pcEnd,
    metadata: rule.metadata,
  };
}

function invalidLandingRefusal(
  provenance: NativeTargetResumeLandingProvenance,
): NativeProcessImageRefusal {
  return {
    code: "target-resume-fault-invalid-code-landing",
    message: `target-native resume entry ${provenance.targetAddress} maps to ${provenance.targetModule.path}+${provenance.targetRelativeAddress} but is not a valid amd64 instruction boundary`,
    detail: {
      landingId: provenance.id,
      targetAddress: provenance.targetAddress,
      targetRelativeAddress: provenance.targetRelativeAddress,
      targetFileOffset: provenance.targetFileOffset,
      targetModule: provenance.targetModule,
      section: provenance.section,
      symbol: provenance.symbol,
      fde: provenance.fde,
      disassembly: provenance.disassembly,
      instructionBoundary: provenance.instructionBoundary,
    },
  };
}

function bytesHex(bytes: Uint8Array, maxBytes: number): string {
  return Array.from(bytes.slice(0, maxBytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hex(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  return `${sign}0x${magnitude.toString(16)}`;
}
