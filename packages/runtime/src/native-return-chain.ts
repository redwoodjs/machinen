import { normalizeNativeHex } from "./native-hex.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";

export interface NativeReturnChainFrame {
  id: string;
  framePointer: string;
  canonicalFrameAddress: string;
  returnAddressSlot: string;
  returnAddress: string;
  unwindId: string;
  callerFramePointer?: string;
}

export interface NativeReturnChainPlanRequest {
  targetStackBase: string;
  targetStackLimit: string;
  maxFrames: number;
  frames: NativeReturnChainFrame[];
}

export interface NativeReturnChainPlanFrame extends NativeReturnChainFrame {
  index: number;
  framePointer: string;
  canonicalFrameAddress: string;
  returnAddressSlot: string;
  returnAddress: string;
  callerFramePointer?: string;
}

export interface NativeReturnChainPlan {
  state: "materialized" | "refused";
  targetStack: { base: string; limit: string };
  frames: NativeReturnChainPlanFrame[];
  refusals: NativeProcessImageRefusal[];
}

export function planNativeReturnChain(
  request: NativeReturnChainPlanRequest,
): NativeReturnChainPlan {
  const frameRefusals = validateReturnChainFrames(request);
  const shapeRefusals = validateReturnChainShape(request);
  const refusals = [...frameRefusals, ...shapeRefusals];
  return {
    state: refusals.length === 0 ? "materialized" : "refused",
    targetStack: {
      base: normalizeAddressOrOriginal(request.targetStackBase),
      limit: normalizeAddressOrOriginal(request.targetStackLimit),
    },
    frames: request.frames.map((frame, index) => ({
      ...frame,
      index,
      framePointer: normalizeAddressOrOriginal(frame.framePointer),
      canonicalFrameAddress: normalizeAddressOrOriginal(frame.canonicalFrameAddress),
      returnAddressSlot: normalizeAddressOrOriginal(frame.returnAddressSlot),
      returnAddress: normalizeAddressOrOriginal(frame.returnAddress),
      callerFramePointer:
        frame.callerFramePointer === undefined
          ? undefined
          : normalizeAddressOrOriginal(frame.callerFramePointer),
    })),
    refusals,
  };
}

function validateReturnChainFrames(
  request: NativeReturnChainPlanRequest,
): NativeProcessImageRefusal[] {
  const bounds = parseStackBounds(request);
  if (bounds.refusals.length > 0) {
    return bounds.refusals;
  }
  return [
    ...validateFrameCount(request),
    ...request.frames.flatMap((frame) => validateFrameAddresses(frame, bounds.base, bounds.limit)),
  ];
}

function validateReturnChainShape(
  request: NativeReturnChainPlanRequest,
): NativeProcessImageRefusal[] {
  return request.frames.flatMap((frame, index) => [
    ...validateFrameProvenance(frame),
    ...validateFrameReturnSlotShape(frame),
    ...validateCallerLink(request.frames, index),
  ]);
}

function validateFrameCount(request: NativeReturnChainPlanRequest): NativeProcessImageRefusal[] {
  if (!Number.isSafeInteger(request.maxFrames) || request.maxFrames <= 0) {
    return [frameLayoutRefusal("return-chain maxFrames must be positive")];
  }
  if (request.frames.length === 0) {
    return [frameLayoutRefusal("return-chain must contain at least one frame")];
  }
  if (request.frames.length > request.maxFrames) {
    return [frameLayoutRefusal("return-chain exceeds the configured frame bound")];
  }
  return [];
}

function validateFrameAddresses(
  frame: NativeReturnChainFrame,
  stackBase: bigint,
  stackLimit: bigint,
): NativeProcessImageRefusal[] {
  const parsed = parseFrameAddresses(frame);
  const malformed = Object.values(parsed).flatMap((address) =>
    address !== undefined && "refusal" in address ? [address.refusal] : [],
  );
  if (malformed.length > 0) {
    return malformed;
  }
  return [
    parsed.framePointer,
    parsed.canonicalFrameAddress,
    parsed.returnAddressSlot,
    ...optionalParsedAddress(parsed.callerFramePointer),
  ]
    .filter(isParsedAddress)
    .flatMap((address) =>
      address.value >= stackBase && address.value < stackLimit
        ? []
        : [frameLayoutRefusal(`return-chain frame ${frame.id} address is outside target stack`)],
    );
}

function validateFrameProvenance(frame: NativeReturnChainFrame): NativeProcessImageRefusal[] {
  return frame.unwindId.startsWith("target:")
    ? []
    : [frameLayoutRefusal(`return-chain frame ${frame.id} unwind identity is unsupported`)];
}

function validateFrameReturnSlotShape(frame: NativeReturnChainFrame): NativeProcessImageRefusal[] {
  const parsed = parseFrameAddresses(frame);
  if ("refusal" in parsed.framePointer || "refusal" in parsed.returnAddressSlot) {
    return [];
  }
  return parsed.returnAddressSlot.value === parsed.framePointer.value + 8n
    ? []
    : [returnSlotRefusal(`return-chain frame ${frame.id} return slot must be framePointer + 8`)];
}

function validateCallerLink(
  frames: NativeReturnChainFrame[],
  index: number,
): NativeProcessImageRefusal[] {
  const frame = frames[index]!;
  const caller = frames[index + 1];
  if (caller === undefined) {
    return frame.callerFramePointer === undefined
      ? []
      : [frameLayoutRefusal(`return-chain terminal frame ${frame.id} must not name a caller`)];
  }
  if (frame.callerFramePointer === undefined) {
    return [frameLayoutRefusal(`return-chain frame ${frame.id} is missing its caller link`)];
  }
  const parsedCaller = parseAddress(
    caller.framePointer,
    `return-chain frame ${caller.id} framePointer`,
  );
  const parsedLink = parseAddress(
    frame.callerFramePointer,
    `return-chain frame ${frame.id} callerFramePointer`,
  );
  if ("refusal" in parsedCaller || "refusal" in parsedLink) {
    return [];
  }
  if (parsedLink.value !== parsedCaller.value) {
    return [
      frameLayoutRefusal(`return-chain frame ${frame.id} caller link does not match next frame`),
    ];
  }
  return parsedCaller.value > parseAddressOrZero(frame.framePointer)
    ? []
    : [
        frameLayoutRefusal(
          `return-chain frame ${frame.id} caller frame must be older on the stack`,
        ),
      ];
}

function parseStackBounds(request: NativeReturnChainPlanRequest): {
  refusals: NativeProcessImageRefusal[];
  base: bigint;
  limit: bigint;
} {
  const base = parseAddress(request.targetStackBase, "target stack base");
  const limit = parseAddress(request.targetStackLimit, "target stack limit");
  const refusals = [base, limit].flatMap((address) =>
    "refusal" in address ? [address.refusal] : [],
  );
  if (refusals.length > 0 || !isParsedAddress(base) || !isParsedAddress(limit)) {
    return { refusals, base: 0n, limit: 0n };
  }
  return base.value < limit.value
    ? { refusals: [], base: base.value, limit: limit.value }
    : {
        refusals: [frameLayoutRefusal("target stack base must be below target stack limit")],
        base: 0n,
        limit: 0n,
      };
}

function parseFrameAddresses(frame: NativeReturnChainFrame) {
  return {
    framePointer: parseAddress(frame.framePointer, `return-chain frame ${frame.id} framePointer`),
    canonicalFrameAddress: parseAddress(
      frame.canonicalFrameAddress,
      `return-chain frame ${frame.id} canonicalFrameAddress`,
    ),
    returnAddressSlot: parseAddress(
      frame.returnAddressSlot,
      `return-chain frame ${frame.id} returnAddressSlot`,
    ),
    returnAddress: parseAddress(
      frame.returnAddress,
      `return-chain frame ${frame.id} returnAddress`,
    ),
    callerFramePointer:
      frame.callerFramePointer === undefined
        ? undefined
        : parseAddress(
            frame.callerFramePointer,
            `return-chain frame ${frame.id} callerFramePointer`,
          ),
  };
}

type ParsedAddress = { value: bigint } | { refusal: NativeProcessImageRefusal };

function optionalParsedAddress(address: ParsedAddress | undefined): ParsedAddress[] {
  return address === undefined ? [] : [address];
}

function isParsedAddress(address: ParsedAddress): address is { value: bigint } {
  return !("refusal" in address);
}

function parseAddress(value: string, field: string): ParsedAddress {
  try {
    return { value: BigInt(value) };
  } catch {
    return { refusal: frameLayoutRefusal(`${field} is not a valid address`) };
  }
}

function parseAddressOrZero(value: string): bigint {
  const parsed = parseAddress(value, "address");
  return "refusal" in parsed ? 0n : parsed.value;
}

function normalizeAddressOrOriginal(value: string): string {
  try {
    return normalizeNativeHex(value);
  } catch {
    return value;
  }
}

function frameLayoutRefusal(message: string): NativeProcessImageRefusal {
  return { code: "target-frame-layout-unsupported", message };
}

function returnSlotRefusal(message: string): NativeProcessImageRefusal {
  return { code: "target-return-slot-unsupported", message };
}
