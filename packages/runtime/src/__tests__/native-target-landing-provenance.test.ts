import { describe, expect, it } from "vitest";

import {
  inspectNativeTargetResumeLanding,
  nativeTargetResumeLandingRefusals,
} from "../native-target-landing-provenance.ts";
import type { NativeRealUtilityResolvedLocation } from "../native-real-utility-code-map.ts";
import type { NativeTargetModuleByteMaterialization } from "../native-target-module-bytes.ts";
import type { NativeTargetUnwindFrameMatch } from "../native-target-unwind.ts";

const location: NativeRealUtilityResolvedLocation = {
  threadId: "thread:115",
  sourceModule: {
    id: "module:mapping:4",
    logicalName: "libc.so.6",
    path: "/usr/lib/aarch64-linux-gnu/libc.so.6",
    arch: "arm64",
    kind: "shared-object",
    buildId: "source-build",
    loadBias: "0xf1657c7c0000",
    textMapping: "mapping:4",
    sourceStart: "0xf1657c800000",
    sourceEnd: "0xf1657c900000",
  },
  targetModule: {
    id: "target:module:mapping:4",
    logicalName: "libc.so.6",
    path: "/usr/lib/x86_64-linux-gnu/libc.so.6",
    arch: "amd64",
    kind: "shared-object",
    buildId: "target-build",
    loadBias: "0x700100000000",
    textMapping: "target:mapping:4",
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x200000" }],
  },
  sourceRva: "0xb6ca0",
  targetRva: "0xb6ca0",
  targetAddress: "0x7001000b6ca0",
  continuationStrategy: "module-rva-equivalence",
  codeLocation: {
    id: "code:thread:115:pc",
    sourceMapping: "mapping:4",
    sourceAddress: "0xf1657c876ca0",
    targetAddress: "0x7001000b6ca0",
    state: "mapped",
  },
};

const targetBytes: NativeTargetModuleByteMaterialization = {
  moduleId: "target:module:mapping:4",
  path: "/target/libc.so.6",
  buildId: "target-build",
  relativeStart: "0xb6ca0",
  relativeEnd: "0xb6cc0",
  fileOffset: 0xb6ca0,
  sizeBytes: 32,
  bytes: Uint8Array.from([
    0xe7, 0x06, 0x48, 0x83, 0xf0, 0x3f, 0x41, 0x29, 0xc7, 0x41, 0x81, 0xff, 0x00, 0x40, 0x00, 0x00,
  ]),
  sourceTextReusedAsTargetCode: false,
};

const fdeMatch: NativeTargetUnwindFrameMatch = {
  sourceFrameId: "frame:thread:115:libc.so.6",
  targetRule: {
    id: "target-eh-frame:libc.so.6:0x7001000b58c0",
    functionName: "libc.so.6",
    mapping: "target:mapping:4",
    pcStart: "0x7001000b58c0",
    pcEnd: "0x7001000b7b00",
    metadata: "eh-frame",
    cfa: { register: "rbp", offset: 16 },
    returnAddress: { location: "cfa-relative", offset: -8 },
  },
  targetAddress: "0x7001000b6ca0",
  targetReturnAddressSlotOffset: -8,
  preservesReturnContract: true,
};

const sections = `
  [15] .rodata           PROGBITS        0000000000020000 020000 006000 00   A  0   0 32
  [16] .text             PROGBITS        00000000000262c0 0262c0 153000 00  AX  0   0 64
`;

const symbols = `
  501: 00000000000b58c0  8734 FUNC    GLOBAL DEFAULT   16 __wcstod_l@@GLIBC_2.2.5
  502: 00000000000b8b00   120 FUNC    GLOBAL DEFAULT   16 next_symbol@@GLIBC_2.2.5
`;

const invalidDisassembly = `
/usr/lib/x86_64-linux-gnu/libc.so.6:     file format elf64-x86-64

Disassembly of section .text:

00000000000b6c60 <__wcstod_l@@GLIBC_2.2.5+0x13a0>:
   b6c60: e9 61 ff ff ff        jmp    b6bc6 <__wcstod_l@@GLIBC_2.2.5+0x1306>
   b6c95: 48 0f bd 84 d4 90 00  bsr    0x90(%rsp,%rdx,8),%rax
   b6c9c: 00 00
   b6c9e: 41 c1 e7 06           shl    $0x6,%r15d
   b6ca2: 48 83 f0 3f           xor    $0x3f,%rax
   b6ca6: 41 29 c7              sub    %eax,%r15d
`;

const validDisassembly = `
/usr/lib/x86_64-linux-gnu/libc.so.6:     file format elf64-x86-64

Disassembly of section .text:

00000000000b6c90 <memcpy@GLIBC_2.2.5+0x8da0>:
   b6c9b: 00 00                 add    %al,(%rax)
   b6ca0: 66 0f 6f 0c 0e        movdqa (%rsi,%rcx,1),%xmm1
   b6ca5: 66 0f 73 d8 0c        psrldq $0xc,%xmm0
`;

describe("native target landing provenance", () => {
  it("classifies a raw cross-ISA offset that lands inside an amd64 instruction", () => {
    const provenance = inspectNativeTargetResumeLanding({
      location,
      targetBytes,
      targetUnwindMatches: [fdeMatch],
      readelfSections: sections,
      readelfSymbols: symbols,
      objdumpDisassembly: invalidDisassembly,
      disassemblyAddressStart: "0xb58c0",
      disassemblyAddressEnd: "0xb6d00",
    });

    expect(provenance).toMatchObject({
      threadId: "thread:115",
      targetAddress: "0x7001000b6ca0",
      targetRelativeAddress: "0xb6ca0",
      targetFileOffset: 0xb6ca0,
      targetInstructionBytes: "e7064883f03f4129c74181ff00400000",
      targetModule: {
        path: "/usr/lib/x86_64-linux-gnu/libc.so.6",
        buildId: "target-build",
      },
      section: { name: ".text", executable: true, match: "address" },
      symbol: {
        name: "__wcstod_l@@GLIBC_2.2.5",
        offset: "0x13e0",
        containsLanding: true,
      },
      fde: { id: "target-eh-frame:libc.so.6:0x7001000b58c0" },
      disassembly: {
        previousLine: "b6c9e: 41 c1 e7 06           shl    $0x6,%r15d",
        nextLine: "b6ca2: 48 83 f0 3f           xor    $0x3f,%rax",
      },
      instructionBoundary: { state: "known-invalid" },
      refusal: { code: "target-resume-fault-invalid-code-landing" },
    });
    expect(nativeTargetResumeLandingRefusals([provenance])).toHaveLength(1);
  });

  it("records a valid boundary when the covering FDE disassembly has an entry line", () => {
    const provenance = inspectNativeTargetResumeLanding({
      location,
      targetBytes: {
        ...targetBytes,
        bytes: Uint8Array.from([0x66, 0x0f, 0x6f, 0x0c, 0x0e]),
      },
      targetUnwindMatches: [fdeMatch],
      readelfSections: sections,
      readelfSymbols: symbols,
      objdumpDisassembly: validDisassembly,
    });

    expect(provenance.instructionBoundary).toMatchObject({ state: "known-valid" });
    expect(provenance.refusal).toBeUndefined();
  });
});
