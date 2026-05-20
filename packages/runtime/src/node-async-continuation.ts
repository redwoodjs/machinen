import {
  NodeRuntimeAdapterUnsupportedError,
  captureNodeRuntimeAdapterDocument,
  restoreNodeRuntimeAdapterRoots,
} from "./node-runtime-adapter.ts";
import type { RuntimeAdapterDocument, RuntimeAdapterRefusal } from "./runtime-adapter.ts";

export type NodeAsyncContinuationKind = "timer" | "promise" | "native-callback";

export interface NodeAsyncContinuationInput {
  id: string;
  kind: NodeAsyncContinuationKind;
  handlerToken: string;
  payload?: unknown;
  delayMs?: number;
  reason?: string;
}

export interface NodeAsyncContinuationRecord {
  id: string;
  kind: "timer" | "promise";
  state: "captured";
  handlerToken: string;
  payloadRoot: string;
  delayMs: number;
}

export interface NodeAsyncContinuationState {
  formatVersion: 1;
  runtime: { name: "node"; version: string };
  strategy: "semantic-continuation";
  adapterDocument: RuntimeAdapterDocument;
  continuations: NodeAsyncContinuationRecord[];
  unsupported: { vocabularyVersion: 1; refusals: RuntimeAdapterRefusal[] };
}

export interface RestoredNodeAsyncContinuation {
  id: string;
  kind: "timer" | "promise";
  result: unknown;
}

export type NodeAsyncContinuationHandlers = Record<string, (payload: unknown) => unknown>;

export function captureNodeAsyncContinuations(
  inputs: NodeAsyncContinuationInput[],
): NodeAsyncContinuationState {
  const roots: Record<string, unknown> = {};
  const continuations: NodeAsyncContinuationRecord[] = [];
  const refusals: RuntimeAdapterRefusal[] = [];
  for (const input of inputs) {
    if (input.kind === "native-callback") {
      refusals.push(nativeCallbackRefusal(input));
      continue;
    }
    const payloadRoot = `continuation:${input.id}:payload`;
    roots[payloadRoot] = input.payload;
    continuations.push({
      id: input.id,
      kind: input.kind,
      state: "captured",
      handlerToken: input.handlerToken,
      payloadRoot,
      delayMs: input.delayMs ?? 0,
    });
  }
  const adapterDocument = captureNodeRuntimeAdapterDocument(roots, {
    adapterId: "node-async-continuation-adapter",
    target: { id: "node-async-continuation", name: "Node async continuation", executable: "node" },
    nativeHandleRefusals: refusals.map((refusal) => ({
      id: `async-refusal:${refusal.detail?.id ?? refusal.code}`,
      kind: "timer",
      code: refusal.code,
      message: refusal.message,
      detail: refusal.detail,
    })),
  });
  return {
    formatVersion: 1,
    runtime: { name: "node", version: globalThis.process?.versions?.node ?? "unknown" },
    strategy: "semantic-continuation",
    adapterDocument,
    continuations,
    unsupported: { vocabularyVersion: 1, refusals },
  };
}

export async function restoreNodeAsyncContinuations(
  state: NodeAsyncContinuationState,
  handlers: NodeAsyncContinuationHandlers,
): Promise<RestoredNodeAsyncContinuation[]> {
  if (state.unsupported.refusals.length > 0) {
    throw new NodeRuntimeAdapterUnsupportedError(state.unsupported.refusals);
  }
  const roots = restoreNodeRuntimeAdapterRoots(state.adapterDocument);
  const restored: RestoredNodeAsyncContinuation[] = [];
  for (const continuation of state.continuations) {
    restored.push(await restoreContinuation(continuation, roots, handlers));
  }
  return restored;
}

async function restoreContinuation(
  continuation: NodeAsyncContinuationRecord,
  roots: Record<string, unknown>,
  handlers: NodeAsyncContinuationHandlers,
): Promise<RestoredNodeAsyncContinuation> {
  const handler = handlers[continuation.handlerToken];
  if (!handler) {
    throw new NodeRuntimeAdapterUnsupportedError([
      {
        code: "runtime-heap-unsupported",
        message: `missing async continuation handler ${continuation.handlerToken}`,
        detail: { id: continuation.id, handlerToken: continuation.handlerToken },
      },
    ]);
  }
  const payload = roots[continuation.payloadRoot];
  const result =
    continuation.kind === "timer"
      ? await restoreTimer(continuation.delayMs, handler, payload)
      : await Promise.resolve().then(() => handler(payload));
  return { id: continuation.id, kind: continuation.kind, result };
}

function restoreTimer(
  delayMs: number,
  handler: (payload: unknown) => unknown,
  payload: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(handler(payload)), delayMs);
  });
}

function nativeCallbackRefusal(input: NodeAsyncContinuationInput): RuntimeAdapterRefusal {
  return {
    code: "runtime-heap-unsupported",
    message:
      input.reason ??
      "native async callbacks need runtime event-loop metadata and cannot be restored semantically yet",
    detail: { id: input.id, kind: input.kind, handlerToken: input.handlerToken },
  };
}
