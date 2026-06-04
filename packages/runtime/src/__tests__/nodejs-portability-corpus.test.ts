import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type NodePortabilityDisposition =
  | "product-supported"
  | "supported-with-declared-config"
  | "refused-first";

interface NodePortabilityRow {
  id: string;
  slug: string;
  runtime: "nodejs";
  disposition: NodePortabilityDisposition;
  dependencies: string[];
  refusalCode: string | null;
  claimGuard: Record<string, false>;
}

interface CompatibilityIndex {
  kind: "machinen.portability-compatibility-index";
  version: number;
  runtime: "nodejs";
  claimBoundary: {
    model: string;
    notClaimed: string[];
    proofMode: string;
    productMode: string;
    claimGuard: Record<string, false>;
  };
  summary: {
    rowCount: number;
    byStatus: Record<string, number>;
    byProductClaim: Record<string, number>;
    architectures: string[];
    verifiedBothArchitectures: number;
    refusedRows: number;
    conditionalRows: number;
    failedClassifiedRows: number;
    verifiedRefusalRows: number;
    unsupportedUnverifiedRows: number;
    coveredRows: number;
  };
  rows: Array<{
    id: string;
    capability: string;
    category: string;
    attemptPolicy: "try-first" | "config-required" | "refuse-live-state";
    status:
      | "verified"
      | "verified-refusal"
      | "classified"
      | "conditional"
      | "failed-classified"
      | "refused";
    architectures: Record<
      string,
      { status: string; evidence: Array<{ kind: string; path: string }> }
    >;
    blockers: Array<{ id: string; severity: string; refusalCode: string | null }>;
    productClaim: {
      status: "claimed" | "candidate" | "conditional" | "verified-refusal" | "refusal" | "none";
      scope: string;
    };
    evidence: Array<{ kind: string; path: string }>;
    claimGuard: Record<string, false>;
  }>;
}

const corpusRoot = resolve("portability/nodejs");

function rowDirs(): string[] {
  return readdirSync(corpusRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readRow(dir: string): NodePortabilityRow {
  return JSON.parse(
    readFileSync(resolve(corpusRoot, dir, "portability.json"), "utf8"),
  ) as NodePortabilityRow;
}

function rowNumber(dir: string): number {
  return Number(dir.slice(0, 3));
}

function selectedProductNodeMemoryRowIds(): string[] {
  return rowDirs()
    .map(readRow)
    .filter((row) => row.disposition === "product-supported" && row.slug.startsWith("memory-real-"))
    .map((row) => row.id)
    .sort();
}

function selectedProductNodeMemoryRefusalCodes(): string[] {
  return [
    "node-portability-memory-pending-promise-unsupported",
    "node-portability-memory-pending-microtask-unsupported",
    "node-portability-memory-active-socket-unsupported",
    "node-portability-memory-active-request-unsupported",
    "node-portability-memory-worker-unsupported",
    "node-portability-memory-native-addon-unsupported",
    "node-portability-memory-child-process-unsupported",
    "node-portability-memory-opaque-native-state-unsupported",
    "node-portability-memory-raw-v8-state-unsupported",
    "node-portability-memory-weakmap-unsupported",
    "node-portability-memory-timer-unsupported",
    "node-portability-memory-stream-unsupported",
  ];
}

function selectedProductNodeResourceRowIds(): string[] {
  return [
    "nodejs-resource-timer-schedule",
    "nodejs-resource-reopenable-file",
    "nodejs-resource-http-listener-route",
    "nodejs-resource-drained-stream-buffer",
    "nodejs-resource-route-registry",
    "nodejs-resource-middleware-registry",
    "nodejs-resource-configured-outbound-client",
    "nodejs-resource-outbound-client-reconnect-policy",
    "nodejs-resource-idle-http-agent-config",
    "nodejs-resource-dns-resolver-config",
    "nodejs-resource-tcp-client-reconnect-config",
    "nodejs-resource-tls-client-reconnect-config",
    "nodejs-resource-udp-client-reconnect-config",
    "nodejs-resource-http2-client-session-config",
    "nodejs-resource-signal-handler-registry",
    "nodejs-resource-immediate-schedule",
    "nodejs-resource-unref-timer-schedule",
    "nodejs-resource-ttl-cache-expiration",
    "nodejs-resource-cache-expiration-timer",
    "nodejs-resource-timer-backed-refill",
    "nodejs-resource-timer-wheel-state",
    "nodejs-resource-delayed-queue-schedule",
    "nodejs-resource-monotonic-clock-baseline",
    "nodejs-resource-performance-timing-baseline",
    "nodejs-resource-active-refresh-schedule",
    "nodejs-resource-drained-readable-stream",
    "nodejs-resource-drained-writable-stream",
    "nodejs-resource-pipeline-drained-state",
    "nodejs-resource-reopenable-read-stream",
    "nodejs-resource-reopenable-write-stream",
    "nodejs-resource-reopenable-dir-handle",
    "nodejs-resource-fs-watcher-subscription",
    "nodejs-resource-transform-stream-drained-state",
    "nodejs-resource-backpressure-buffer-drained",
    "nodejs-resource-stream-backed-logger-sink",
    "nodejs-resource-log-transport-drained",
    "nodejs-resource-diagnostic-channel-subscription",
    "nodejs-resource-diagnostic-report-config",
    "nodejs-resource-profiler-session-disabled-config",
    "nodejs-resource-inspector-disabled-config",
    "nodejs-resource-distributed-rate-limit-config",
    "nodejs-resource-span-context-drained",
    "nodejs-resource-otel-exporter-config",
    "nodejs-resource-async-local-storage-snapshot",
    "nodejs-resource-async-hooks-registry",
    "nodejs-resource-proxy-descriptor",
    "nodejs-resource-esm-namespace-binding",
    "nodejs-resource-dynamic-import-settled-module",
    "nodejs-resource-module-loader-hook-registry",
    "nodejs-resource-object-keyed-map-descriptor",
    "nodejs-resource-map-iterator-position",
    "nodejs-resource-set-iterator-position",
    "nodejs-resource-error-stack-snapshot",
    "nodejs-resource-uncaught-exception-handler-registry",
    "nodejs-resource-private-field-descriptor",
    "nodejs-resource-bound-method-descriptor",
    "nodejs-resource-listener-closure-registry",
    "nodejs-resource-async-state-machine-snapshot",
    "nodejs-resource-mutable-config-snapshot",
    "nodejs-resource-serializer-replacer-registry",
    "nodejs-resource-regexp-match-iterator-position",
    "nodejs-resource-regexp-target-native-compile",
    "nodejs-resource-script-target-native-compile",
    "nodejs-resource-synthetic-module-declaration",
    "nodejs-resource-module-link-graph",
    "nodejs-resource-wasm-module-target-native-compile",
    "nodejs-resource-transfer-list-descriptor",
    "nodejs-resource-symbol-iterator-position",
    "nodejs-resource-numeric-overflow-policy",
    "nodejs-resource-temporal-object-descriptor",
    "nodejs-resource-vm-context-template",
    "nodejs-resource-vm-sandbox-global-descriptor",
    "nodejs-resource-wasm-instance-target-native",
    "nodejs-resource-wasm-memory-linear-bytes",
    "nodejs-resource-wasm-table-descriptor",
    "nodejs-resource-readline-interface-config",
    "nodejs-resource-tty-mode-config",
    "nodejs-resource-parser-token-checkpoint",
    "nodejs-resource-incremental-parser-checkpoint",
    "nodejs-resource-websocket-listener-registry",
    "nodejs-resource-worker-thread-restart",
    "nodejs-resource-native-addon-target-rebuild",
    "nodejs-resource-child-process-restart",
    "nodejs-resource-native-compiled-artifact-rebuild",
    "nodejs-resource-hash-public-input-digest",
    "nodejs-resource-deterministic-prng-seed",
    "nodejs-resource-buffer-pool-policy",
    "nodejs-resource-zero-fill-buffer-policy",
    "nodejs-resource-external-arraybuffer-declared-bytes",
    "nodejs-resource-weak-cache-drop-policy",
    "nodejs-resource-queue-consumer-retry-checkpoint",
    "nodejs-resource-pending-transition-checkpoint",
    "nodejs-resource-stdio-config",
    "nodejs-resource-transaction-retry-checkpoint",
    "nodejs-resource-cursor-query-descriptor",
    "nodejs-resource-oauth-device-flow-restart",
    "nodejs-resource-noncloneable-reconstruction-factory",
    "nodejs-resource-hmac-key-reference",
    "nodejs-resource-keyobject-reference",
    "nodejs-resource-cipher-key-reference",
    "nodejs-resource-webcrypto-algorithm-registry",
    "nodejs-resource-secret-config-reference",
    "nodejs-resource-crypto-secret-reference",
    "nodejs-resource-credential-cache-reference",
    "nodejs-resource-keyring-reference",
    "nodejs-resource-sensitive-buffer-redaction",
    "nodejs-resource-job-retry-policy",
    "nodejs-resource-job-lock-release-policy",
    "nodejs-resource-quiesced-active-request",
    "nodejs-resource-settled-promise-value",
    "nodejs-resource-drained-promise-reaction",
    "nodejs-resource-drained-microtask-queue",
    "nodejs-resource-settled-async-function-frame",
    "nodejs-resource-drained-stdin",
    "nodejs-resource-drained-messageport",
    "nodejs-resource-drained-broadcastchannel",
    "nodejs-resource-sharedarraybuffer-quiesced-copy",
    "nodejs-resource-atomics-no-waiters",
    "nodejs-resource-worker-shared-buffer-quiesced",
    "nodejs-resource-quiesced-async-context-resource",
    "nodejs-resource-declared-ffi-adapter",
    "nodejs-resource-declared-native-resource-adapter",
    "nodejs-resource-http-request-template",
    "nodejs-resource-http-response-template",
    "nodejs-resource-request-body-drained",
    "nodejs-resource-response-writer-drained",
    "nodejs-resource-request-scope-registry",
    "nodejs-resource-framework-plugin-registry",
    "nodejs-resource-scoped-provider-registry",
    "nodejs-resource-provider-factory-registry",
    "nodejs-resource-lifecycle-hook-registry",
    "nodejs-resource-render-context-template",
    "nodejs-resource-zlib-stream-drained-state",
    "nodejs-resource-brotli-stream-drained-state",
    "nodejs-resource-inflate-stream-drained-state",
    "nodejs-resource-deflate-stream-drained-state",
    "nodejs-resource-write-ahead-buffer-flushed",
  ];
}

function selectedProductNodeResourceRefusalCodes(): string[] {
  return [
    "node-portability-resource-active-timer-unsupported",
    "node-portability-resource-native-handle-unsupported",
    "node-portability-resource-active-tls-unsupported",
    "node-portability-resource-worker-live-state-unsupported",
  ];
}

function expectSelectedProductNodeMemoryRowEvidence(
  rowEvidence: Array<{ rowId: string; stages: Record<string, boolean> }>,
): void {
  expect(rowEvidence.map((row) => row.rowId)).toEqual(selectedProductNodeMemoryRowIds());
  for (const row of rowEvidence) {
    for (const stage of [
      "detect",
      "capture",
      "decode",
      "classify",
      "materialize",
      "verify",
      "retain",
    ]) {
      expect(row.stages[stage]).toBe(true);
    }
  }
}

describe("Node.js portability corpus", () => {
  it("documents the caniuse-style compatibility structure", () => {
    const readme = readFileSync(resolve("portability/README.md"), "utf8");
    const schema = JSON.parse(
      readFileSync(resolve("portability/compatibility.schema.json"), "utf8"),
    ) as {
      title: string;
      properties: Record<string, unknown>;
    };
    expect(readme).toContain("caniuse.com");
    expect(readme).toContain("Proof mode: try broadly");
    expect(schema.title).toBe("Machinen portability compatibility index");
    expect(schema.properties).toHaveProperty("rows");
  });

  it("renders a caniuse-style dashboard backed by the Node compatibility index", () => {
    const index = JSON.parse(
      readFileSync(resolve(corpusRoot, "index.json"), "utf8"),
    ) as CompatibilityIndex;
    const html = readFileSync(resolve(corpusRoot, "index.html"), "utf8");
    const embedded =
      /<script id="embedded-nodejs-portability-index" type="application\/json">\n([\s\S]*?)\n\s*<\/script>/u.exec(
        html,
      );
    expect(embedded?.[1]).toBeDefined();
    expect(JSON.parse(embedded![1]!)).toEqual(index);
    expect(html).toContain("Node.js portability compatibility");
    expect(html).toContain("raw V8 heap restore");
    expect(html).toContain("active socket stream transfer");
    expect(html).toContain("nodejs-portability-deps-amd64-runtime-report.json");
    expect(html).toContain("nodejs-portability-memory-scalar-arm64-to-amd64-report.json");
    expect(html).toContain("nodejs-portability-memory-plain-object-report.json");
    expect(html).toContain("nodejs-portability-memory-array-report.json");
    expect(html).toContain("nodejs-portability-memory-closure-context-report.json");
    expect(html).toContain("nodejs-portability-memory-unsupported-boundaries-report.json");
    expect(html).toContain("nodejs-portability-memory-real-plain-object-report.json");
    expect(html).toContain("nodejs-portability-memory-real-promise-refusal-report.json");
    expect(html).toContain("nodejs-portability-memory-real-array-report.json");
  });

  it("contains the requested 312 numbered workload rows", () => {
    const dirs = rowDirs();
    expect(dirs).toHaveLength(312);
    expect(dirs.slice(0, 3)).toEqual([
      "001-plain-http-create-server",
      "002-express",
      "003-fastify",
    ]);
    expect(dirs.slice(54, 62)).toEqual([
      "055-memory-real-arraybuffer-dataview",
      "056-memory-real-symbol-keyed-object",
      "057-memory-real-eventemitter-listeners",
      "058-memory-real-in-memory-lru-cache",
      "059-memory-real-queue-state",
      "060-memory-real-weakmap-refusal",
      "061-memory-real-timer-refusal",
      "062-memory-real-stream-refusal",
    ]);
    expect(dirs.slice(-5)).toEqual([
      "308-memory-real-opaque-native-handles-refusal",
      "309-memory-real-unknown-v8-object-refusal",
      "310-memory-real-unclassified-state-refusal",
      "311-memory-real-metadata-only-success-refusal",
      "312-memory-real-source-isa-emulation-refusal",
    ]);
    expect(dirs.map(rowNumber)).toEqual(Array.from({ length: 312 }, (_, index) => index + 1));
  });

  it("keeps arbitrary raw Node process restore out of the corpus claim", () => {
    const rows = rowDirs().map(readRow);
    expect(rows).toHaveLength(312);
    for (const row of rows) {
      expect(row.runtime).toBe("nodejs");
      expect(row.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("marks unsafe live-state cases as refused-first with stable refusal codes", () => {
    const refused = rowDirs()
      .map(readRow)
      .filter((row) => row.disposition === "refused-first");
    expect(refused).toHaveLength(154);
    expect(refused.map((row) => row.id).slice(0, 12)).toEqual([
      "010-websocket-server",
      "016-worker-thread-app",
      "017-native-addon-app",
      "018-child-process-app",
      "019-active-request-app",
      "020-outbound-connection-app",
      "025-memory-unsupported-boundaries",
      "035-memory-pending-promise-refusal",
      "049-memory-real-promise-refusal",
      "060-memory-real-weakmap-refusal",
      "061-memory-real-timer-refusal",
      "062-memory-real-stream-refusal",
    ]);
    expect(refused.map((row) => row.id).slice(-5)).toEqual([
      "308-memory-real-opaque-native-handles-refusal",
      "309-memory-real-unknown-v8-object-refusal",
      "310-memory-real-unclassified-state-refusal",
      "311-memory-real-metadata-only-success-refusal",
      "312-memory-real-source-isa-emulation-refusal",
    ]);
    for (const row of refused) {
      expect(row.refusalCode).toMatch(/^node-portability-.+-unsupported$/u);
    }
  });

  it("publishes the Node compatibility index as capability rows, not app trophies", () => {
    const index = JSON.parse(
      readFileSync(resolve(corpusRoot, "index.json"), "utf8"),
    ) as CompatibilityIndex;
    expect(index).toMatchObject({
      kind: "machinen.portability-compatibility-index",
      version: 1,
      runtime: "nodejs",
      summary: {
        rowCount: 312,
        byStatus: { verified: 300, "verified-refusal": 12 },
        byProductClaim: { candidate: 300, "verified-refusal": 12 },
        architectures: ["arm64", "amd64"],
        verifiedBothArchitectures: 300,
        verifiedRefusalRows: 12,
        refusedRows: 0,
        unsupportedUnverifiedRows: 0,
        coveredRows: 312,
        conditionalRows: 0,
        failedClassifiedRows: 0,
      },
    });
    expect(index.claimBoundary.model).toContain(
      "arbitrary Node.js application portability dimensions",
    );
    expect(index.claimBoundary.notClaimed).toEqual(
      expect.arrayContaining(["raw V8 heap restore", "raw CPU/process continuation"]),
    );
    const resourceIrRows = index.rows.filter((row) =>
      [
        "061-memory-real-timer-refusal",
        "083-memory-real-interval-refusal",
        "084-memory-real-immediate-refusal",
        "085-memory-real-unref-timer-refusal",
        "087-memory-real-scheduled-callback-refusal",
        "088-memory-real-readable-stream-refusal",
        "089-memory-real-writable-stream-refusal",
        "091-memory-real-pipeline-refusal",
        "143-memory-real-ttl-cache-refusal",
        "146-memory-real-cache-expiration-timer-refusal",
        "173-memory-real-filehandle-refusal",
        "176-memory-real-open-read-stream-refusal",
        "177-memory-real-open-write-stream-refusal",
        "181-memory-real-process-signal-handler-refusal",
        "267-memory-real-scheduler-timer-refusal",
        "280-memory-real-timer-backed-refill-refusal",
      ].includes(row.id),
    );
    expect(resourceIrRows).toHaveLength(16);
    expect(resourceIrRows.every((row) => row.status === "verified")).toBe(true);
    expect(
      resourceIrRows.every((row) => row.productClaim.scope === "node-resource-ir-product-proof"),
    ).toBe(true);
    for (const row of index.rows) {
      expect(row.capability.length).toBeGreaterThan(10);
      expect(row.architectures).toHaveProperty("arm64");
      expect(row.architectures).toHaveProperty("amd64");
      expect(row.productClaim.status).not.toBe("claimed");
      expect(row.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("keeps Node live-state refusals wired into the product portable VM plan path", () => {
    const cli = readFileSync(resolve("packages/cli/src/cli.ts"), "utf8");
    const report = JSON.parse(
      readFileSync(
        resolve(
          "proofs/linux-vm-workload/portable-vm-product-node-refusals/retained/portable-vm-product-node-refusal-report.json",
        ),
        "utf8",
      ),
    ) as { accepted: boolean; rows: Array<{ marker: string; refusalCode: string }> };
    expect(report.accepted).toBe(true);
    expect(report.rows.map((row) => row.refusalCode)).toEqual([
      "node-portability-active-websocket-unsupported",
      "node-portability-worker-thread-unsupported",
      "node-portability-native-addon-unsupported",
      "node-portability-child-process-unsupported",
      "node-portability-active-request-unsupported",
      "node-portability-outbound-connection-unsupported",
    ]);
    for (const row of report.rows) {
      expect(cli).toContain(row.marker);
      expect(cli).toContain(row.refusalCode);
    }
    expect(cli).toContain("nodejs-portability-inventory.json");
    expect(cli).toContain("classify-against-node-portability-compatibility-index");
    expect(cli).toContain("nodejs-memory-ir.json");
    expect(cli).toContain("nodejs-memory-classification.json");
    expect(cli).toContain("materialize-nodejs-memory-ir-target-native");
    expect(cli).toContain("node-portability-memory-pending-promise-unsupported");
    expect(cli).toContain("node-portability-memory-weakmap-unsupported");
    expect(cli).toContain("node-portability-memory-timer-unsupported");
    expect(cli).toContain("node-portability-memory-stream-unsupported");
    expect(cli).toContain('arbitraryNodeProcessRestoreClaimed": false');
    expect(cli).toContain('rawV8HeapRestoreUsed": false');
  });

  it("retains all-row fail-closed coverage for unsupported rows", () => {
    const report = JSON.parse(
      readFileSync(
        resolve(corpusRoot, "retained/nodejs-portability-refusal-coverage-report.json"),
        "utf8",
      ),
    ) as {
      accepted: boolean;
      rowCount: number;
      supportedRows: number;
      verifiedRefusalRows: number;
      unsupportedUnverifiedRows: number;
      allRowsAccountedFor: boolean;
      verifiedRefusals: Array<{
        status: string;
        architectures: Record<string, { status: string }>;
      }>;
    };
    expect(report).toMatchObject({
      accepted: true,
      rowCount: 312,
      supportedRows: 300,
      verifiedRefusalRows: 12,
      unsupportedUnverifiedRows: 0,
      allRowsAccountedFor: true,
    });
    expect(report.verifiedRefusals).toHaveLength(12);
    expect(
      report.verifiedRefusals.every(
        (row) =>
          row.status === "verified-refusal" &&
          row.architectures.arm64?.status === "verified-refusal" &&
          row.architectures.amd64?.status === "verified-refusal",
      ),
    ).toBe(true);
  });

  it("retains a bidirectional classification report for arm64 and amd64", () => {
    const report = JSON.parse(
      readFileSync(resolve(corpusRoot, "retained/nodejs-portability-corpus-report.json"), "utf8"),
    ) as {
      accepted: boolean;
      rowCount: number;
      architectures: string[];
      executeVm: boolean;
      summary: Record<string, number>;
      claimGuard: Record<string, false>;
    };
    expect(report).toMatchObject({
      accepted: true,
      rowCount: 312,
      architectures: ["arm64", "amd64"],
      executeVm: false,
      summary: {
        productSupportedRows: 153,
        declaredConfigRows: 5,
        refusedFirstRows: 154,
        refusedRows: 308,
      },
      claimGuard: {
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      },
    });
  });

  it("retains runtime-controlled arm64 and amd64 VM execution for dependency-free rows", () => {
    for (const [file, arch] of [
      ["nodejs-portability-no-deps-runtime-report.json", "arm64"],
      ["nodejs-portability-no-deps-amd64-runtime-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        rowCount: number;
        architectures: string[];
        executeVm: boolean;
        summary: Record<string, number>;
      };
      expect(report).toMatchObject({
        accepted: true,
        rowCount: 5,
        architectures: [arch],
        executeVm: true,
        summary: {
          productSupportedRows: 5,
          verifiedVmRows: 5,
          environmentUnavailableRows: 0,
        },
      });
    }
  });

  it("retains memory-state portability smoke reports", () => {
    for (const [file, rowId, expectedState] of [
      ["nodejs-portability-memory-plain-object-report.json", "022-memory-plain-object", "verified"],
      ["nodejs-portability-memory-array-report.json", "023-memory-array", "verified"],
      [
        "nodejs-portability-memory-closure-context-report.json",
        "024-memory-closure-context",
        "verified",
      ],
      [
        "nodejs-portability-memory-unsupported-boundaries-report.json",
        "025-memory-unsupported-boundaries",
        "refused",
      ],
      ["nodejs-portability-memory-string-report.json", "026-memory-string", "verified"],
      [
        "nodejs-portability-memory-nested-object-graph-report.json",
        "027-memory-nested-object-graph",
        "verified",
      ],
      [
        "nodejs-portability-memory-shared-references-report.json",
        "028-memory-shared-references",
        "verified",
      ],
      ["nodejs-portability-memory-cycle-report.json", "029-memory-cycle", "verified"],
      ["nodejs-portability-memory-map-set-report.json", "030-memory-map-set", "verified"],
      [
        "nodejs-portability-memory-class-instance-report.json",
        "031-memory-class-instance",
        "verified",
      ],
      [
        "nodejs-portability-memory-http-handler-closure-state-report.json",
        "032-memory-http-handler-closure-state",
        "verified",
      ],
      ["nodejs-portability-memory-buffer-report.json", "033-memory-buffer", "verified"],
      ["nodejs-portability-memory-typed-array-report.json", "034-memory-typed-array", "verified"],
      [
        "nodejs-portability-memory-real-plain-object-report.json",
        "037-memory-real-plain-object",
        "verified",
      ],
      [
        "nodejs-portability-memory-pending-promise-refusal-report.json",
        "035-memory-pending-promise-refusal",
        "refused",
      ],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        portabilityRow: string;
        architectures: string[];
        results: Array<{ id: string; state: string }>;
        claimGuard: Record<string, false>;
      };
      expect(report.accepted).toBe(true);
      expect(report.portabilityRow).toBe(rowId);
      expect(report.architectures).toEqual(["arm64", "amd64"]);
      expect(report.results).toEqual([
        expect.objectContaining({ id: rowId, architecture: "arm64", state: expectedState }),
        expect.objectContaining({ id: rowId, architecture: "amd64", state: expectedState }),
      ]);
      expect(report.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        rawCpuStateReplayUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("retains bidirectional real memory materialization evidence for selected shapes", () => {
    const shapes = [
      "plain-object",
      "array",
      "closure-context",
      "string",
      "nested-object-graph",
      "shared-references",
      "cycle",
      "map-set",
      "class-instance",
      "buffer",
      "typed-array",
      "http-handler-closure-state",
      "date-regexp",
      "error-object",
      "url-searchparams",
      "bigint-rich-graph",
      "module-singleton-state",
      "arraybuffer-dataview",
      "symbol-keyed-object",
      "eventemitter-listeners",
      "in-memory-lru-cache",
      "queue-state",
    ];
    for (const shape of shapes) {
      const forward = JSON.parse(
        readFileSync(
          resolve(corpusRoot, `retained/nodejs-portability-memory-real-${shape}-report.json`),
          "utf8",
        ),
      ) as {
        accepted: boolean;
        sourceArch: string;
        targetArch: string;
        memoryCapture: string;
        migrationCompleted: boolean;
        sourceCapture: {
          memoryIr?: { kind: string };
          evidence: { decodedFields: Record<string, { found: boolean }> };
        };
        targetResult: { targetNativeNode: true; verifier: { accepted: boolean } };
        claimGuard: Record<string, false>;
      };
      const reverse = JSON.parse(
        readFileSync(
          resolve(
            corpusRoot,
            `retained/nodejs-portability-memory-real-${shape}-amd64-to-arm64-report.json`,
          ),
          "utf8",
        ),
      ) as typeof forward;
      for (const [report, sourceArch, targetArch] of [
        [forward, "arm64", "amd64"],
        [reverse, "amd64", "arm64"],
      ] as const) {
        expect(report).toMatchObject({
          accepted: true,
          sourceArch,
          targetArch,
          memoryCapture: "real-guest-proc-maps-and-proc-mem",
          migrationCompleted: true,
        });
        expect(
          Object.values(report.sourceCapture.evidence.decodedFields).every((field) => field.found),
        ).toBe(true);
        expect(report.targetResult).toMatchObject({
          targetNativeNode: true,
          verifier: { accepted: true },
        });
        expect(report.claimGuard).toMatchObject({
          arbitraryNodeProcessRestoreClaimed: false,
          rawV8HeapRestoreUsed: false,
          sourceIsaEmulationUsed: false,
        });
      }
    }
  });

  it("retains cross-arch real memory plain-object materialization evidence", () => {
    const report = JSON.parse(
      readFileSync(
        resolve(corpusRoot, "retained/nodejs-portability-memory-real-plain-object-report.json"),
        "utf8",
      ),
    ) as {
      accepted: boolean;
      portabilityRow: string;
      sourceArch: string;
      targetArch: string;
      memoryCapture: string;
      migrationCompleted: boolean;
      sourceCapture: {
        captureMethod: string;
        appHookUsedForCapture: false;
        rawV8HeapRestored: false;
        objectState: { count: number; nested: { label: string } };
        evidence: { decodedFields: Record<string, { found: boolean }> };
      };
      targetResult: {
        materialization: string;
        targetNativeNode: true;
        verifier: { accepted: boolean };
      };
      claimGuard: Record<string, false>;
    };
    expect(report).toMatchObject({
      accepted: true,
      portabilityRow: "037-memory-real-plain-object",
      sourceArch: "arm64",
      targetArch: "amd64",
      memoryCapture: "real-guest-proc-maps-and-proc-mem",
      migrationCompleted: true,
    });
    expect(report.sourceCapture.captureMethod).toBe(
      "guest-proc-maps-and-proc-mem-anchor-object-decoder",
    );
    expect(
      Object.values(report.sourceCapture.evidence.decodedFields).every((field) => field.found),
    ).toBe(true);
    expect(report.sourceCapture.objectState).toMatchObject({
      count: 7,
      nested: { label: "portable" },
    });
    expect(report.targetResult).toMatchObject({
      materialization: "target-native-node-semantic-object-ir",
      targetNativeNode: true,
      verifier: { accepted: true },
    });
    expect(report.claimGuard).toMatchObject({
      arbitraryNodeProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      sourceIsaEmulationUsed: false,
    });
  });

  it("retains product portable VM Node memory IR snapshot/restore evidence", () => {
    const proofRoot = resolve(
      "proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained",
    );
    const expectedMemoryRowIds = selectedProductNodeMemoryRowIds();
    const report = JSON.parse(
      readFileSync(resolve(proofRoot, "portable-vm-product-node-memory-ir-report.json"), "utf8"),
    ) as {
      accepted: boolean;
      productCommandPath: string;
      acceptedPath: {
        nodejsMemoryRows: number;
        memoryMaterializationRows: number;
        memoryVerified: boolean;
        materializedRows: number;
        supportedSemanticRows: string[];
        rowEvidence: Array<{ rowId: string; stages: Record<string, boolean> }>;
        restoreStrategy: string;
        memoryIrKind: string;
      };
      refusalPath: { restoreRefused: boolean; refusalCode: string };
      refusalMatrix: Array<{ restoreRefused: boolean; refusalCode: string }>;
      claimGuard: Record<string, false>;
    };
    const plan = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/portable-vm-manifest-plan.json"), "utf8"),
    ) as {
      captureBoundary: Record<string, unknown>;
      restorePlan: { rows: Array<Record<string, unknown>> };
    };
    const inventory = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/portable-vm-raw-inventory.json"), "utf8"),
    ) as { items: Array<Record<string, unknown>>; pauseBoundary: Record<string, unknown> };
    const pauseBoundary = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/portable-vm-pause-boundary.json"), "utf8"),
    ) as Record<string, unknown>;
    const memoryIr = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/nodejs-memory-ir.json"), "utf8"),
    ) as { kind: string; rows: Array<{ id: string }> };
    const resourceIr = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/nodejs-resource-ir.json"), "utf8"),
    ) as { kind: string; rows: Array<{ id: string }> };
    const classification = JSON.parse(
      readFileSync(
        resolve(proofRoot, "node-memory.snap/nodejs-memory-classification.json"),
        "utf8",
      ),
    ) as { restoreStrategy: string };
    const resourceClassification = JSON.parse(
      readFileSync(
        resolve(proofRoot, "node-memory.snap/nodejs-resource-classification.json"),
        "utf8",
      ),
    ) as { restoreStrategy: string };
    const resourceInventory = JSON.parse(
      readFileSync(resolve(proofRoot, "node-memory.snap/nodejs-resource-inventory.json"), "utf8"),
    ) as { checkedResourceClasses: string[] };
    const materializer = readFileSync(
      resolve(proofRoot, "node-memory.snap/nodejs-memory-materializer.mjs"),
      "utf8",
    );
    const resourceMaterializer = readFileSync(
      resolve(proofRoot, "node-memory.snap/nodejs-resource-materializer.mjs"),
      "utf8",
    );
    const acceptRestore = JSON.parse(
      readFileSync(resolve(proofRoot, "accept-restore.json"), "utf8"),
    ) as {
      targetRestore: {
        nodejsMemory: { materialized: boolean; materializedRows: number };
        nodejsResource: { materialized: boolean; materializedRows: number };
      };
      targetVerify: {
        nodejsMemory: { accepted: boolean; memoryIrKind: string; materializedRows: number };
        nodejsResource: { accepted: boolean; resourceIrKind: string; materializedRows: number };
      };
      workloads: {
        nodejs: {
          memoryVerified: boolean;
          resourceVerified: boolean;
          memoryMaterializedRows: number;
          resourceMaterializedRows: number;
        };
      };
    };
    const refusalRestore = JSON.parse(
      readFileSync(resolve(proofRoot, "refusal-pending-promise-restore.json"), "utf8"),
    ) as {
      accepted: boolean;
      refusal: { code: string };
      workloads: { nodejs: { refusals: Array<{ refusalCode: string }>; memoryRefusals: string[] } };
    };
    const noPauseRestore = JSON.parse(
      readFileSync(resolve(proofRoot, "no-pause-boundary-restore.json"), "utf8"),
    ) as { accepted: boolean; refusal: { code: string } };
    expect(report).toMatchObject({
      accepted: true,
      productCommandPath:
        "machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json",
      acceptedPath: {
        nodejsMemoryRows: 1,
        nodejsResourceRows: 1,
        sourceVmPauseBoundary: {
          accepted: true,
          sourceVmPauseRequired: true,
          stoppedStateObserved: true,
          pauseMechanism: "vmm-native-sigusr1-sigusr2",
          unsupportedPausedLiveStatePolicy: "refuse",
        },
        memoryMaterializationRows: 1,
        resourceMaterializationRows: 1,
        memoryVerified: true,
        resourceVerified: true,
        materializedRows: expectedMemoryRowIds.length,
        resourceMaterializedRows: selectedProductNodeResourceRowIds().length,
        supportedSemanticRows: expectedMemoryRowIds,
        supportedResourceRows: selectedProductNodeResourceRowIds(),
        resourceCaptureBoundary: {
          sourceVmPauseRequired: true,
          stabilityPoint: "source-vm-paused",
          unsupportedPausedLiveStatePolicy: "refuse",
        },
        restoreStrategy: "materialize-nodejs-memory-ir-target-native",
        resourceRestoreStrategy: "materialize-nodejs-resource-ir-target-native",
        memoryIrKind: "machinen.nodejs.memory-ir",
        resourceIrKind: "machinen.nodejs.resource-ir",
      },
      refusalPath: {
        restoreRefused: true,
        refusalCode: "node-portability-memory-pending-promise-unsupported",
      },
      pauseBoundaryRefusal: {
        restoreRefused: true,
        refusalCode: "node-portability-resource-pause-boundary-missing",
      },
    });
    expect(pauseBoundary).toMatchObject({
      accepted: true,
      sourceVmPauseRequired: true,
      stoppedStateObserved: true,
      pauseMechanism: "vmm-native-sigusr1-sigusr2",
      unsupportedPausedLiveStatePolicy: "refuse",
    });
    expect(plan.captureBoundary).toMatchObject({
      sourceVmPauseRequired: true,
      stabilityPoint: "source-vm-paused",
      pauseBoundary: "portable-vm-pause-boundary.json",
      unsupportedPausedLiveStatePolicy: "refuse",
    });
    expect(inventory.pauseBoundary).toMatchObject({ stoppedStateObserved: true });
    expect(plan.restorePlan.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "nodejs-memory-ir",
          category: "nodejs",
          disposition: "product-supported",
          restoreStrategy: "materialize-nodejs-memory-ir-target-native",
          artifact: "nodejs-memory-ir.json",
        }),
        expect.objectContaining({
          id: "nodejs-resource-ir",
          category: "nodejs",
          disposition: "product-supported",
          restoreStrategy: "materialize-nodejs-resource-ir-target-native",
          artifact: "nodejs-resource-ir.json",
        }),
      ]),
    );
    expect(inventory.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "nodejs-memory-ir" }),
        expect.objectContaining({ id: "nodejs-resource-inventory" }),
        expect.objectContaining({ id: "nodejs-resource-ir" }),
      ]),
    );
    expect(memoryIr.kind).toBe("machinen.nodejs.memory-ir");
    expect(memoryIr.rows.map((row) => row.id)).toEqual(expectedMemoryRowIds);
    expect(resourceInventory.checkedResourceClasses).toEqual(
      expect.arrayContaining(["timers", "file-handles", "native-handles"]),
    );
    expect(resourceIr.kind).toBe("machinen.nodejs.resource-ir");
    expect(resourceIr).toMatchObject({
      captureBoundary: {
        sourceVmPauseRequired: true,
        stabilityPoint: "source-vm-paused",
        unsupportedPausedLiveStatePolicy: "refuse",
      },
    });
    expect(resourceIr.rows.map((row) => row.id)).toEqual(selectedProductNodeResourceRowIds());
    expectSelectedProductNodeMemoryRowEvidence(report.acceptedPath.rowEvidence);
    expect(classification.restoreStrategy).toBe("materialize-nodejs-memory-ir-target-native");
    expect(resourceClassification.restoreStrategy).toBe(
      "materialize-nodejs-resource-ir-target-native",
    );
    expect(materializer).toContain("machinen.nodejs.memory-ir");
    expect(materializer).toContain("rawV8HeapRestoreUsed");
    expect(resourceMaterializer).toContain("machinen.nodejs.resource-ir");
    expect(resourceMaterializer).toContain("rawNativeHandleRestoreUsed");
    expect(acceptRestore).toMatchObject({
      targetRestore: {
        nodejsMemory: { materialized: true, materializedRows: expectedMemoryRowIds.length },
        nodejsResource: {
          materialized: true,
          materializedRows: selectedProductNodeResourceRowIds().length,
        },
      },
      targetVerify: {
        nodejsMemory: {
          accepted: true,
          memoryIrKind: "machinen.nodejs.memory-ir",
          materializedRows: expectedMemoryRowIds.length,
        },
        nodejsResource: {
          accepted: true,
          resourceIrKind: "machinen.nodejs.resource-ir",
          materializedRows: selectedProductNodeResourceRowIds().length,
        },
      },
      workloads: {
        nodejs: {
          memoryVerified: true,
          resourceVerified: true,
          memoryMaterializedRows: expectedMemoryRowIds.length,
          resourceMaterializedRows: selectedProductNodeResourceRowIds().length,
        },
      },
    });
    expect(report.refusalMatrix.map((row) => row.refusalCode)).toEqual([
      ...selectedProductNodeMemoryRefusalCodes(),
      ...selectedProductNodeResourceRefusalCodes(),
    ]);
    for (const row of report.refusalMatrix) {
      expect(row.restoreRefused).toBe(true);
    }
    expect(noPauseRestore).toMatchObject({
      accepted: false,
      refusal: { code: "node-portability-resource-pause-boundary-missing" },
    });
    expect(refusalRestore).toMatchObject({
      accepted: false,
      refusal: { code: "node-portability-memory-pending-promise-unsupported" },
      workloads: {
        nodejs: {
          refusals: [
            expect.objectContaining({
              refusalCode: "node-portability-memory-pending-promise-unsupported",
            }),
          ],
          memoryRefusals: ["node-portability-memory-pending-promise-unsupported"],
        },
      },
    });
    expect(report.claimGuard).toMatchObject({
      arbitraryVmRestoreClaimed: false,
      rawVmStateReplayUsed: false,
      arbitraryNodeProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      rawNativeHandleRestoreUsed: false,
    });
  });

  it("retains cross-arch product portable VM Node memory IR materialization evidence", () => {
    const proofRoot = resolve(
      "proofs/linux-vm-workload/portable-vm-product-node-memory-ir-cross-arch/retained",
    );
    const expectedMemoryRowIds = selectedProductNodeMemoryRowIds();
    const report = JSON.parse(
      readFileSync(
        resolve(proofRoot, "portable-vm-product-node-memory-ir-cross-arch-report.json"),
        "utf8",
      ),
    ) as {
      accepted: boolean;
      directions: Array<{
        id: string;
        sourceArch: string;
        targetArch: string;
        memoryVerified: boolean;
        resourceVerified: boolean;
        memoryMaterializedRows: number;
        resourceMaterializedRows: number;
        supportedSemanticRows: string[];
        supportedResourceRows: string[];
        sourceVmPauseBoundary: Record<string, unknown>;
        resourceCaptureBoundary: Record<string, unknown>;
        rowEvidence: Array<{ rowId: string; stages: Record<string, boolean> }>;
        productMaterializerInjected: boolean;
        productResourceMaterializerInjected: boolean;
      }>;
      claimGuard: Record<string, false>;
    };
    expect(report.accepted).toBe(true);
    expect(report.directions).toEqual([
      expect.objectContaining({
        id: "arm64-to-amd64",
        sourceArch: "arm64",
        targetArch: "amd64",
        memoryVerified: true,
        resourceVerified: true,
        memoryMaterializedRows: expectedMemoryRowIds.length,
        resourceMaterializedRows: selectedProductNodeResourceRowIds().length,
        supportedSemanticRows: expectedMemoryRowIds,
        supportedResourceRows: selectedProductNodeResourceRowIds(),
        sourceVmPauseBoundary: expect.objectContaining({
          accepted: true,
          sourceVmPauseRequired: true,
          stoppedStateObserved: true,
          pauseMechanism: "vmm-native-sigusr1-sigusr2",
          unsupportedPausedLiveStatePolicy: "refuse",
        }),
        resourceCaptureBoundary: {
          sourceVmPauseRequired: true,
          stabilityPoint: "source-vm-paused",
          unsupportedPausedLiveStatePolicy: "refuse",
        },
        productMaterializerInjected: true,
        productResourceMaterializerInjected: true,
      }),
      expect.objectContaining({
        id: "amd64-to-arm64",
        sourceArch: "amd64",
        targetArch: "arm64",
        memoryVerified: true,
        resourceVerified: true,
        memoryMaterializedRows: expectedMemoryRowIds.length,
        resourceMaterializedRows: selectedProductNodeResourceRowIds().length,
        supportedSemanticRows: expectedMemoryRowIds,
        supportedResourceRows: selectedProductNodeResourceRowIds(),
        sourceVmPauseBoundary: expect.objectContaining({
          accepted: true,
          sourceVmPauseRequired: true,
          stoppedStateObserved: true,
          pauseMechanism: "vmm-native-sigusr1-sigusr2",
          unsupportedPausedLiveStatePolicy: "refuse",
        }),
        resourceCaptureBoundary: {
          sourceVmPauseRequired: true,
          stabilityPoint: "source-vm-paused",
          unsupportedPausedLiveStatePolicy: "refuse",
        },
        productMaterializerInjected: true,
        productResourceMaterializerInjected: true,
      }),
    ]);
    for (const direction of ["arm64-to-amd64", "amd64-to-arm64"] as const) {
      const restore = JSON.parse(
        readFileSync(resolve(proofRoot, `${direction}-restore.json`), "utf8"),
      ) as {
        accepted: boolean;
        workloads: {
          nodejs: {
            memoryVerified: boolean;
            resourceVerified: boolean;
            memoryMaterializedRows: number;
            resourceMaterializedRows: number;
          };
        };
        targetVerify: {
          nodejsMemory: { accepted: boolean; memoryIrKind: string };
          nodejsResource: { accepted: boolean; resourceIrKind: string };
        };
      };
      const materializer = readFileSync(
        resolve(proofRoot, `${direction}/node-memory.snap/nodejs-memory-materializer.mjs`),
        "utf8",
      );
      const resourceMaterializer = readFileSync(
        resolve(proofRoot, `${direction}/node-memory.snap/nodejs-resource-materializer.mjs`),
        "utf8",
      );
      const resourceIr = JSON.parse(
        readFileSync(
          resolve(proofRoot, `${direction}/node-memory.snap/nodejs-resource-ir.json`),
          "utf8",
        ),
      ) as { kind: string; rows: Array<{ id: string }> };
      const pauseBoundary = JSON.parse(
        readFileSync(
          resolve(proofRoot, `${direction}/node-memory.snap/portable-vm-pause-boundary.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const resourceInventory = JSON.parse(
        readFileSync(
          resolve(proofRoot, `${direction}/node-memory.snap/nodejs-resource-inventory.json`),
          "utf8",
        ),
      ) as { checkedResourceClasses: string[] };
      const rowEvidence = JSON.parse(
        readFileSync(
          resolve(
            proofRoot,
            `${direction}/node-memory.snap/nodejs-memory-product-row-evidence.json`,
          ),
          "utf8",
        ),
      ) as Array<{ rowId: string; stages: Record<string, boolean> }>;
      expectSelectedProductNodeMemoryRowEvidence(rowEvidence);
      expect(pauseBoundary).toMatchObject({
        accepted: true,
        sourceVmPauseRequired: true,
        stoppedStateObserved: true,
        pauseMechanism: "vmm-native-sigusr1-sigusr2",
        unsupportedPausedLiveStatePolicy: "refuse",
      });
      expect(resourceInventory.checkedResourceClasses).toEqual(
        expect.arrayContaining(["timers", "file-handles", "native-handles"]),
      );
      expect(resourceIr.kind).toBe("machinen.nodejs.resource-ir");
      expect(resourceIr).toMatchObject({
        captureBoundary: {
          sourceVmPauseRequired: true,
          stabilityPoint: "source-vm-paused",
          unsupportedPausedLiveStatePolicy: "refuse",
        },
      });
      expect(resourceIr.rows.map((row) => row.id)).toEqual(selectedProductNodeResourceRowIds());
      expect(restore).toMatchObject({
        accepted: true,
        workloads: {
          nodejs: {
            memoryVerified: true,
            resourceVerified: true,
            memoryMaterializedRows: expectedMemoryRowIds.length,
            resourceMaterializedRows: selectedProductNodeResourceRowIds().length,
          },
        },
        targetVerify: {
          nodejsMemory: { accepted: true, memoryIrKind: "machinen.nodejs.memory-ir" },
          nodejsResource: { accepted: true, resourceIrKind: "machinen.nodejs.resource-ir" },
        },
      });
      expect(materializer).toContain("machinen.nodejs.memory-ir");
      expect(materializer).toContain("rawV8HeapRestoreUsed");
      expect(resourceMaterializer).toContain("machinen.nodejs.resource-ir");
      expect(resourceMaterializer).toContain("rawNativeHandleRestoreUsed");
    }
    for (const direction of report.directions) {
      expectSelectedProductNodeMemoryRowEvidence(direction.rowEvidence);
    }
    expect(report.claimGuard).toMatchObject({
      arbitraryVmRestoreClaimed: false,
      rawVmStateReplayUsed: false,
      arbitraryNodeProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      rawNativeHandleRestoreUsed: false,
    });
  });

  it("retains fail-closed real Promise memory refusal evidence", () => {
    const report = JSON.parse(
      readFileSync(
        resolve(corpusRoot, "retained/nodejs-portability-memory-real-promise-refusal-report.json"),
        "utf8",
      ),
    ) as {
      accepted: boolean;
      portabilityRow: string;
      migrationCompleted: boolean;
      refusal: { code: string };
      results: Array<{ id: string; state: string; refusalCode: string }>;
      memoryIr: { unsupported: Array<{ code: string }> };
      claimGuard: Record<string, false>;
    };
    expect(report).toMatchObject({
      accepted: true,
      portabilityRow: "049-memory-real-promise-refusal",
      migrationCompleted: false,
      refusal: { code: "node-portability-memory-pending-promise-unsupported" },
    });
    expect(report.results).toEqual([
      expect.objectContaining({ id: "049-memory-real-promise-refusal", state: "refused" }),
      expect.objectContaining({ id: "049-memory-real-promise-refusal", state: "refused" }),
    ]);
    expect(report.memoryIr.unsupported).toEqual([
      expect.objectContaining({ code: "node-portability-memory-pending-promise-unsupported" }),
    ]);
    expect(report.claimGuard.rawV8HeapRestoreUsed).toBe(false);
  });

  it("retains real guest /proc memory classifier smoke reports", () => {
    for (const [file, arch] of [
      ["nodejs-portability-memory-capture-classifier-report.json", "arm64"],
      ["nodejs-portability-memory-capture-classifier-amd64-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        portabilityRow: string;
        architectures: string[];
        executeVm: boolean;
        memoryCapture: string;
        capture: { categories: Record<string, { found: boolean }>; captureMethod: string };
        claimGuard: Record<string, false>;
      };
      expect(report).toMatchObject({
        accepted: true,
        portabilityRow: "036-memory-capture-classifier",
        architectures: [arch],
        executeVm: true,
        memoryCapture: "real-guest-proc-maps-and-proc-mem",
      });
      expect(report.capture.captureMethod).toBe("guest-proc-maps-and-proc-mem-anchor-classifier");
      expect(Object.values(report.capture.categories).every((category) => category.found)).toBe(
        true,
      );
      expect(report.claimGuard).toMatchObject({
        arbitraryNodeProcessRestoreClaimed: false,
        rawV8HeapRestoreUsed: false,
        sourceIsaEmulationUsed: false,
      });
    }
  });

  it("retains runtime-controlled arm64 and amd64 VM execution for dependency-backed rows", () => {
    for (const [file, arch] of [
      ["nodejs-portability-deps-arm64-runtime-report.json", "arm64"],
      ["nodejs-portability-deps-amd64-runtime-report.json", "amd64"],
    ] as const) {
      const report = JSON.parse(readFileSync(resolve(corpusRoot, "retained", file), "utf8")) as {
        accepted: boolean;
        rowCount: number;
        architectures: string[];
        executeVm: boolean;
        installDeps: boolean;
        summary: Record<string, number>;
        results: Array<{ id: string; state: string }>;
      };
      expect(report).toMatchObject({
        accepted: true,
        rowCount: 9,
        architectures: [arch],
        executeVm: true,
        installDeps: true,
        summary: {
          productSupportedRows: 4,
          declaredConfigRows: 5,
          verifiedVmRows: 9,
          failedClassifiedRows: 0,
          environmentUnavailableRows: 0,
        },
      });
      expect(report.results.map((row) => row.id)).toEqual([
        "002-express",
        "003-fastify",
        "004-koa",
        "005-hono",
        "006-next-minimal-server",
        "007-remix-react-router-server",
        "008-nestjs",
        "009-graphql-apollo",
        "012-postgres-app",
      ]);
      expect(report.results.every((row) => row.state === "verified")).toBe(true);
    }
  });
});
