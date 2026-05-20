import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type {
  NativeAmd64Registers,
  NativeThreadTranslation,
} from "../packages/runtime/src/native-process-image.ts";
import { assert } from "./proof-script-utils.mjs";

export const FINAL_JUMP_PAGE_SIZE = 4096;
export const FINAL_JUMP_STACK_SIZE = 64 * 1024;
export const FINAL_JUMP_ENTRY_OFFSET = 128;
export const FINAL_JUMP_STORE_MARKER = 0x4e454e494843414dn;
export const FINAL_JUMP_EXPECTED_RETURN = 0x4dn;
export const FINAL_JUMP_TARGET_TEXT_START = 0x14000000n;
export const FINAL_JUMP_TARGET_DATA_START = 0x15000000n;
export const FINAL_JUMP_TARGET_STACK_START = 0x500000000000n;
export const FINAL_JUMP_TARGET_ENTRY =
  FINAL_JUMP_TARGET_TEXT_START + BigInt(FINAL_JUMP_ENTRY_OFFSET);
export const FINAL_JUMP_TARGET_STACK_POINTER =
  FINAL_JUMP_TARGET_STACK_START + BigInt(FINAL_JUMP_STACK_SIZE) - 16n;

export function finalJumpHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

export function finalJumpTargetCode() {
  const code = Buffer.from([
    0x48,
    0x89,
    0x27,
    0x48,
    0xb8,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x48,
    0x89,
    0x47,
    0x08,
    0xb8,
    Number(FINAL_JUMP_EXPECTED_RETURN),
    0,
    0,
    0,
    0xc3,
  ]);
  code.writeBigUInt64LE(FINAL_JUMP_STORE_MARKER, 5);
  return code;
}

export function finalJumpBundleMemory(textMarker: string, initialDataWord0?: bigint) {
  return finalJumpBundleMemoryFromTargetText(textMarker, finalJumpTargetCode(), initialDataWord0);
}

export function finalJumpBundleMemoryFromTargetText(
  textMarker: string,
  targetText: Buffer,
  initialDataWord0?: bigint,
) {
  const text = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  text.write(textMarker, 0, "utf8");
  assert(
    targetText.length <= FINAL_JUMP_PAGE_SIZE - FINAL_JUMP_ENTRY_OFFSET,
    "target text does not fit in final-jump text page",
  );
  targetText.copy(text, FINAL_JUMP_ENTRY_OFFSET);
  const data = Buffer.alloc(FINAL_JUMP_PAGE_SIZE);
  if (initialDataWord0 !== undefined) {
    data.writeBigUInt64LE(initialDataWord0, 0);
  }
  return Buffer.concat([text, data]);
}

export function requireFinalJumpAmd64Registers(
  thread: NativeThreadTranslation | undefined,
  label: string,
): NativeAmd64Registers {
  const targetRegisters = thread?.targetRegisters;
  if (!targetRegisters || targetRegisters.arch !== "amd64") {
    throw new Error(`${label} thread did not translate to amd64`);
  }
  return targetRegisters;
}

export function jumpIntoFinalTargetNativeCode(options: {
  label: string;
  trampoline: string;
  bundleDir: string;
  targetRegisters: NativeAmd64Registers;
  textMarker: string;
  expectedInitialDataWord0?: bigint;
}) {
  assert(
    options.targetRegisters.rip === finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    `${options.label} target rip does not match code map`,
  );
  assert(
    options.targetRegisters.rdi === finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    `${options.label} target rdi was not relocated`,
  );
  assert(
    options.targetRegisters.rsp === finalJumpHex(FINAL_JUMP_TARGET_STACK_POINTER),
    `${options.label} target rsp does not match stack plan`,
  );

  const args = [
    "--memory",
    join(options.bundleDir, "native-memory.bin"),
    "--text-offset",
    "0",
    "--text-size",
    String(FINAL_JUMP_PAGE_SIZE),
    "--text-target-start",
    finalJumpHex(FINAL_JUMP_TARGET_TEXT_START),
    "--entry-offset",
    String(FINAL_JUMP_ENTRY_OFFSET),
    "--expect-prefix",
    options.textMarker,
    "--data-offset",
    String(FINAL_JUMP_PAGE_SIZE),
    "--data-size",
    String(FINAL_JUMP_PAGE_SIZE),
    "--data-target-start",
    finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    "--stack-target-start",
    finalJumpHex(FINAL_JUMP_TARGET_STACK_START),
    "--stack-size",
    String(FINAL_JUMP_STACK_SIZE),
    "--arg0",
    options.targetRegisters.rdi,
    "--expect-return",
    finalJumpHex(FINAL_JUMP_EXPECTED_RETURN),
    "--expect-store-marker",
    finalJumpHex(FINAL_JUMP_STORE_MARKER),
  ];
  if (options.expectedInitialDataWord0 !== undefined) {
    args.push("--expect-initial-word0", finalJumpHex(options.expectedInitialDataWord0));
  }

  const result = spawnSync(options.trampoline, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  assert(result.status === 0, `native ${options.label} trampoline failed: ${result.stderr}`);
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MACHINEN_NATIVE_RESUME_TRAMPOLINE "));
  assert(line, `native ${options.label} trampoline did not emit a resume event`);
  return JSON.parse(line.slice("MACHINEN_NATIVE_RESUME_TRAMPOLINE ".length));
}

export function validateFinalJumpResumeEvent(
  resumeEvent: { [key: string]: unknown },
  label: string,
) {
  assert(resumeEvent.status === "jumped", `${label} did not execute target code`);
  assert(resumeEvent.targetArch === "amd64", `${label} executed the wrong target arch`);
  assert(
    resumeEvent.entry === finalJumpHex(FINAL_JUMP_TARGET_ENTRY),
    `${label} used the wrong entry`,
  );
  assert(
    resumeEvent.argument === finalJumpHex(FINAL_JUMP_TARGET_DATA_START),
    `${label} used the wrong arg0`,
  );
  assert(
    resumeEvent.returnValue === finalJumpHex(FINAL_JUMP_EXPECTED_RETURN),
    `${label} returned the wrong value`,
  );
  assert(
    resumeEvent.storedMarker === finalJumpHex(FINAL_JUMP_STORE_MARKER),
    `${label} stored the wrong marker`,
  );
  assert(resumeEvent.usedTargetStack === true, `${label} did not use the target stack`);
}
