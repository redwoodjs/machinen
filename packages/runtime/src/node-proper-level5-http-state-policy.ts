export const NODE_PROPER_LEVEL5_HTTP_STATE_POLICY_KIND =
  "machinen.node-proper-level5-http-state-policy" as const;

export type NodeProperLevel5HttpStatePolicyRefusalCode =
  | "node-proper-level5-http-active-request-unsupported"
  | "node-proper-level5-http-partial-read-unsupported"
  | "node-proper-level5-http-partial-write-unsupported"
  | "node-proper-level5-http-ambiguous-connection-state";

export interface NodeProperLevel5HttpStatePolicyRefusal {
  code: NodeProperLevel5HttpStatePolicyRefusalCode;
  message: string;
}

export interface NodeProperLevel5HttpStatePolicyInput {
  activeRequestDetected?: boolean;
  partialReadDetected?: boolean;
  partialWriteDetected?: boolean;
  ambiguousConnectionState?: boolean;
  idleKeepAliveSockets?: number;
}

export interface NodeProperLevel5HttpStatePolicyResult {
  kind: typeof NODE_PROPER_LEVEL5_HTTP_STATE_POLICY_KIND;
  accepted: boolean;
  activeRequestPolicy: "refuse-active-request" | "no-active-request-detected";
  idleKeepAlivePolicy: "none-detected" | "safe-close-and-recreate-idle-connections-on-target";
  refusals: NodeProperLevel5HttpStatePolicyRefusal[];
}

export function classifyNodeProperLevel5HttpStatePolicy(
  input: NodeProperLevel5HttpStatePolicyInput,
): NodeProperLevel5HttpStatePolicyResult {
  const refusals = httpStateRefusals(input);
  return {
    kind: NODE_PROPER_LEVEL5_HTTP_STATE_POLICY_KIND,
    accepted: refusals.length === 0,
    activeRequestPolicy: input.activeRequestDetected
      ? "refuse-active-request"
      : "no-active-request-detected",
    idleKeepAlivePolicy:
      (input.idleKeepAliveSockets ?? 0) > 0
        ? "safe-close-and-recreate-idle-connections-on-target"
        : "none-detected",
    refusals,
  };
}

function httpStateRefusals(
  input: NodeProperLevel5HttpStatePolicyInput,
): NodeProperLevel5HttpStatePolicyRefusal[] {
  const checks: Array<[boolean | undefined, NodeProperLevel5HttpStatePolicyRefusalCode]> = [
    [input.activeRequestDetected, "node-proper-level5-http-active-request-unsupported"],
    [input.partialReadDetected, "node-proper-level5-http-partial-read-unsupported"],
    [input.partialWriteDetected, "node-proper-level5-http-partial-write-unsupported"],
    [input.ambiguousConnectionState, "node-proper-level5-http-ambiguous-connection-state"],
  ];
  return checks
    .filter(([detected]) => detected)
    .map(([, code]) => ({ code, message: httpStateRefusalMessage(code) }));
}

function httpStateRefusalMessage(code: NodeProperLevel5HttpStatePolicyRefusalCode): string {
  const messages: Record<NodeProperLevel5HttpStatePolicyRefusalCode, string> = {
    "node-proper-level5-http-active-request-unsupported":
      "active HTTP request state must refuse instead of being reconstructed",
    "node-proper-level5-http-partial-read-unsupported":
      "partial HTTP request reads are unsupported",
    "node-proper-level5-http-partial-write-unsupported":
      "partial HTTP response writes are unsupported",
    "node-proper-level5-http-ambiguous-connection-state":
      "ambiguous HTTP connection state is unsupported",
  };
  return messages[code];
}
