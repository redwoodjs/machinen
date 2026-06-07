#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "portability/nodejs";
const claimGuard = {
  arbitraryNodeProcessRestoreClaimed: false,
  rawV8HeapRestoreUsed: false,
  rawCpuStateReplayUsed: false,
  sourceIsaEmulationUsed: false,
};
const evidenceInputs = [
  ["classification-report", "portability/nodejs/retained/nodejs-portability-corpus-report.json"],
  ["runtime-report", "portability/nodejs/retained/nodejs-portability-no-deps-runtime-report.json"],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-no-deps-amd64-runtime-report.json",
  ],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-deps-arm64-runtime-report.json",
  ],
  [
    "runtime-report",
    "portability/nodejs/retained/nodejs-portability-deps-amd64-runtime-report.json",
  ],
  ["runtime-report", "portability/nodejs/retained/nodejs-portability-row001-runtime-report.json"],
  [
    "memory-scalar-smoke-report",
    "portability/nodejs/retained/nodejs-portability-memory-scalar-arm64-to-amd64-report.json",
  ],
  [
    "memory-state-smoke-report",
    "portability/nodejs/retained/nodejs-portability-memory-plain-object-report.json",
  ],
  [
    "memory-state-smoke-report",
    "portability/nodejs/retained/nodejs-portability-memory-array-report.json",
  ],
  [
    "memory-state-smoke-report",
    "portability/nodejs/retained/nodejs-portability-memory-closure-context-report.json",
  ],
  [
    "memory-state-refusal-smoke-report",
    "portability/nodejs/retained/nodejs-portability-memory-unsupported-boundaries-report.json",
  ],
];
const categoryBySlug = {
  "plain-http-create-server": "http",
  express: "framework",
  fastify: "framework",
  koa: "framework",
  hono: "framework",
  "next-minimal-server": "framework-server",
  "remix-react-router-server": "framework-server",
  nestjs: "framework-server",
  "graphql-apollo": "api",
  "websocket-server": "realtime",
  "sqlite-app": "state",
  "postgres-app": "state",
  "static-file-server": "filesystem",
  "file-upload-app": "filesystem",
  "cron-timer-app": "scheduler",
  "worker-thread-app": "concurrency-blocker",
  "native-addon-app": "native-blocker",
  "child-process-app": "process-blocker",
  "active-request-app": "live-state-blocker",
  "outbound-connection-app": "network-blocker",
  "memory-scalar-counter": "memory-state",
  "memory-plain-object": "memory-state",
  "memory-array": "memory-state",
  "memory-closure-context": "memory-state",
  "memory-unsupported-boundaries": "memory-blocker",
  "memory-string": "memory-state",
  "memory-nested-object-graph": "memory-state",
  "memory-shared-references": "memory-state",
  "memory-cycle": "memory-state",
  "memory-map-set": "memory-state",
  "memory-class-instance": "memory-state",
  "memory-http-handler-closure-state": "memory-state",
  "memory-buffer": "memory-state",
  "memory-typed-array": "memory-state",
  "memory-pending-promise-refusal": "memory-blocker",
  "memory-capture-classifier": "memory-state",
  "memory-real-plain-object": "memory-state",
  "memory-real-array": "memory-state",
  "memory-real-closure-context": "memory-state",
  "memory-real-string": "memory-state",
  "memory-real-nested-object-graph": "memory-state",
  "memory-real-shared-references": "memory-state",
  "memory-real-cycle": "memory-state",
  "memory-real-map-set": "memory-state",
  "memory-real-class-instance": "memory-state",
  "memory-real-buffer": "memory-state",
  "memory-real-typed-array": "memory-state",
  "memory-real-http-handler-closure-state": "memory-state",
  "memory-real-date-regexp": "memory-state",
  "memory-real-error-object": "memory-state",
  "memory-real-url-searchparams": "memory-state",
  "memory-real-bigint-rich-graph": "memory-state",
  "memory-real-module-singleton-state": "memory-state",
  "memory-real-arraybuffer-dataview": "memory-state",
  "memory-real-symbol-keyed-object": "memory-state",
  "memory-real-eventemitter-listeners": "memory-state",
  "memory-real-in-memory-lru-cache": "memory-state",
  "memory-real-queue-state": "memory-state",
  "memory-real-weakmap-refusal": "memory-blocker",
  "memory-real-timer-refusal": "memory-blocker",
  "memory-real-stream-refusal": "memory-blocker",
  "memory-real-promise-refusal": "memory-blocker",
};
const productResourceCompatibilityRows = {
  "061-memory-real-timer-refusal": "nodejs-resource-timer-schedule",
  "083-memory-real-interval-refusal": "nodejs-resource-timer-schedule",
  "084-memory-real-immediate-refusal": "nodejs-resource-immediate-schedule",
  "085-memory-real-unref-timer-refusal": "nodejs-resource-unref-timer-schedule",
  "087-memory-real-scheduled-callback-refusal": "nodejs-resource-timer-schedule",
  "088-memory-real-readable-stream-refusal": "nodejs-resource-drained-readable-stream",
  "089-memory-real-writable-stream-refusal": "nodejs-resource-drained-writable-stream",
  "091-memory-real-pipeline-refusal": "nodejs-resource-pipeline-drained-state",
  "143-memory-real-ttl-cache-refusal": "nodejs-resource-ttl-cache-expiration",
  "146-memory-real-cache-expiration-timer-refusal": "nodejs-resource-cache-expiration-timer",
  "173-memory-real-filehandle-refusal": "nodejs-resource-reopenable-file",
  "176-memory-real-open-read-stream-refusal": "nodejs-resource-reopenable-read-stream",
  "177-memory-real-open-write-stream-refusal": "nodejs-resource-reopenable-write-stream",
  "181-memory-real-process-signal-handler-refusal": "nodejs-resource-signal-handler-registry",
  "267-memory-real-scheduler-timer-refusal": "nodejs-resource-timer-schedule",
  "280-memory-real-timer-backed-refill-refusal": "nodejs-resource-timer-backed-refill",
  "086-memory-real-timer-wheel-refusal": "nodejs-resource-timer-wheel-state",
  "151-memory-real-delayed-queue-refusal": "nodejs-resource-delayed-queue-schedule",
  "221-memory-real-monotonic-clock-refusal": "nodejs-resource-monotonic-clock-baseline",
  "222-memory-real-performance-timing-refusal": "nodejs-resource-performance-timing-baseline",
  "275-memory-real-active-refresh-refusal": "nodejs-resource-active-refresh-schedule",
  "174-memory-real-dir-handle-refusal": "nodejs-resource-reopenable-dir-handle",
  "175-memory-real-fs-watcher-refusal": "nodejs-resource-fs-watcher-subscription",
  "090-memory-real-transform-stream-refusal": "nodejs-resource-transform-stream-drained-state",
  "092-memory-real-backpressure-buffer-refusal": "nodejs-resource-backpressure-buffer-drained",
  "229-memory-real-stream-backed-logger-refusal": "nodejs-resource-stream-backed-logger-sink",
  "231-memory-real-log-transport-refusal": "nodejs-resource-log-transport-drained",
  "238-memory-real-zlib-stream-refusal": "nodejs-resource-zlib-stream-drained-state",
  "240-memory-real-brotli-stream-refusal": "nodejs-resource-brotli-stream-drained-state",
  "241-memory-real-inflate-state-refusal": "nodejs-resource-inflate-stream-drained-state",
  "242-memory-real-deflate-state-refusal": "nodejs-resource-deflate-stream-drained-state",
  "272-memory-real-write-ahead-buffer-refusal": "nodejs-resource-write-ahead-buffer-flushed",
  "104-memory-real-request-refusal": "nodejs-resource-http-request-template",
  "105-memory-real-response-refusal": "nodejs-resource-http-response-template",
  "165-memory-real-active-request-body-refusal": "nodejs-resource-request-body-drained",
  "166-memory-real-response-writer-refusal": "nodejs-resource-response-writer-drained",
  "171-memory-real-request-scope-refusal": "nodejs-resource-request-scope-registry",
  "172-memory-real-framework-plugin-refusal": "nodejs-resource-framework-plugin-registry",
  "289-memory-real-scoped-provider-refusal": "nodejs-resource-scoped-provider-registry",
  "290-memory-real-provider-factory-refusal": "nodejs-resource-provider-factory-registry",
  "292-memory-real-lifecycle-hook-refusal": "nodejs-resource-lifecycle-hook-registry",
  "296-memory-real-render-context-refusal": "nodejs-resource-render-context-template",
  "020-outbound-connection-app": "nodejs-resource-outbound-client-reconnect-policy",
  "167-memory-real-http-agent-state-refusal": "nodejs-resource-idle-http-agent-config",
  "190-memory-real-dns-pending-refusal": "nodejs-resource-dns-resolver-config",
  "188-memory-real-tcp-socket-refusal": "nodejs-resource-tcp-client-reconnect-config",
  "189-memory-real-tls-socket-refusal": "nodejs-resource-tls-client-reconnect-config",
  "191-memory-real-udp-socket-refusal": "nodejs-resource-udp-client-reconnect-config",
  "192-memory-real-http2-session-refusal": "nodejs-resource-http2-client-session-config",
  "232-memory-real-diagnostic-channel-refusal": "nodejs-resource-diagnostic-channel-subscription",
  "236-memory-real-diagnostic-report-refusal": "nodejs-resource-diagnostic-report-config",
  "237-memory-real-profiler-session-refusal": "nodejs-resource-profiler-session-disabled-config",
  "235-memory-real-active-inspector-refusal": "nodejs-resource-inspector-disabled-config",
  "282-memory-real-distributed-rate-limit-refusal": "nodejs-resource-distributed-rate-limit-config",
  "284-memory-real-span-inflight-refusal": "nodejs-resource-span-context-drained",
  "287-memory-real-otel-exporter-refusal": "nodejs-resource-otel-exporter-config",
  "065-memory-real-async-local-storage-refusal": "nodejs-resource-async-local-storage-snapshot",
  "066-memory-real-async-hooks-resource-refusal": "nodejs-resource-async-hooks-registry",
  "068-memory-real-proxy-refusal": "nodejs-resource-proxy-descriptor",
  "078-memory-real-esm-namespace-refusal": "nodejs-resource-esm-namespace-binding",
  "080-memory-real-dynamic-import-state-refusal": "nodejs-resource-dynamic-import-settled-module",
  "081-memory-real-module-loader-hook-refusal": "nodejs-resource-module-loader-hook-registry",
  "114-memory-real-object-keyed-map-refusal": "nodejs-resource-object-keyed-map-descriptor",
  "116-memory-real-map-iterator-refusal": "nodejs-resource-map-iterator-position",
  "117-memory-real-set-iterator-refusal": "nodejs-resource-set-iterator-position",
  "121-memory-real-error-stack-refusal": "nodejs-resource-error-stack-snapshot",
  "122-memory-real-uncaught-exception-state-refusal":
    "nodejs-resource-uncaught-exception-handler-registry",
  "134-memory-real-private-fields-refusal": "nodejs-resource-private-field-descriptor",
  "137-memory-real-bound-method-refusal": "nodejs-resource-bound-method-descriptor",
  "142-memory-real-listener-closure-refusal": "nodejs-resource-listener-closure-registry",
  "157-memory-real-async-state-machine-refusal": "nodejs-resource-async-state-machine-snapshot",
  "161-memory-real-mutable-config-refusal": "nodejs-resource-mutable-config-snapshot",
  "202-memory-real-serializer-replacer-refusal": "nodejs-resource-serializer-replacer-registry",
  "216-memory-real-regexp-match-iterator-refusal": "nodejs-resource-regexp-match-iterator-position",
  "217-memory-real-regexp-compiled-code-refusal": "nodejs-resource-regexp-target-native-compile",
  "244-memory-real-script-compiled-state-refusal": "nodejs-resource-script-target-native-compile",
  "245-memory-real-synthetic-module-refusal": "nodejs-resource-synthetic-module-declaration",
  "247-memory-real-module-link-state-refusal": "nodejs-resource-module-link-graph",
  "252-memory-real-wasm-compiled-code-refusal": "nodejs-resource-wasm-module-target-native-compile",
  "062-memory-real-stream-refusal": "nodejs-resource-drained-stream-buffer",
  "102-memory-real-arraybuffer-transfer-refusal": "nodejs-resource-transfer-list-descriptor",
  "201-memory-real-transfer-list-refusal": "nodejs-resource-transfer-list-descriptor",
  "206-memory-real-symbol-iterator-refusal": "nodejs-resource-symbol-iterator-position",
  "211-memory-real-numeric-overflow-refusal": "nodejs-resource-numeric-overflow-policy",
  "220-memory-real-temporal-object-refusal": "nodejs-resource-temporal-object-descriptor",
  "243-memory-real-vm-context-refusal": "nodejs-resource-vm-context-template",
  "246-memory-real-vm-sandbox-global-refusal": "nodejs-resource-vm-sandbox-global-descriptor",
  "248-memory-real-wasm-instance-refusal": "nodejs-resource-wasm-instance-target-native",
  "250-memory-real-wasm-memory-refusal": "nodejs-resource-wasm-memory-linear-bytes",
  "251-memory-real-wasm-table-refusal": "nodejs-resource-wasm-table-descriptor",
  "261-memory-real-readline-interface-refusal": "nodejs-resource-readline-interface-config",
  "262-memory-real-tty-state-refusal": "nodejs-resource-tty-mode-config",
  "299-memory-real-parser-mid-token-refusal": "nodejs-resource-parser-token-checkpoint",
  "302-memory-real-incremental-parser-refusal": "nodejs-resource-incremental-parser-checkpoint",
  "010-websocket-server": "nodejs-resource-websocket-listener-registry",
  "016-worker-thread-app": "nodejs-resource-worker-thread-restart",
  "183-memory-real-worker-expanded-refusal": "nodejs-resource-worker-thread-restart",
  "017-native-addon-app": "nodejs-resource-native-addon-target-rebuild",
  "179-memory-real-native-addon-expanded-refusal": "nodejs-resource-native-addon-target-rebuild",
  "018-child-process-app": "nodejs-resource-child-process-restart",
  "178-memory-real-child-process-expanded-refusal": "nodejs-resource-child-process-restart",
  "294-memory-real-native-compiled-artifact-refusal":
    "nodejs-resource-native-compiled-artifact-rebuild",
  "093-memory-real-hash-state-refusal": "nodejs-resource-hash-public-input-digest",
  "097-memory-real-random-generator-state-refusal": "nodejs-resource-deterministic-prng-seed",
  "125-memory-real-buffer-pool-refusal": "nodejs-resource-buffer-pool-policy",
  "126-memory-real-unsafe-buffer-refusal": "nodejs-resource-zero-fill-buffer-policy",
  "127-memory-real-external-arraybuffer-refusal":
    "nodejs-resource-external-arraybuffer-declared-bytes",
  "147-memory-real-cache-weak-values-refusal": "nodejs-resource-weak-cache-drop-policy",
  "152-memory-real-queue-consumer-inflight-refusal":
    "nodejs-resource-queue-consumer-retry-checkpoint",
  "155-memory-real-pending-transition-refusal": "nodejs-resource-pending-transition-checkpoint",
  "182-memory-real-stdio-handle-refusal": "nodejs-resource-stdio-config",
  "270-memory-real-transaction-inflight-refusal": "nodejs-resource-transaction-retry-checkpoint",
  "271-memory-real-cursor-refusal": "nodejs-resource-cursor-query-descriptor",
  "277-memory-real-oauth-device-flow-refusal": "nodejs-resource-oauth-device-flow-restart",
  "200-memory-real-noncloneable-object-refusal":
    "nodejs-resource-noncloneable-reconstruction-factory",
  "094-memory-real-hmac-state-refusal": "nodejs-resource-hmac-key-reference",
  "095-memory-real-keyobject-refusal": "nodejs-resource-keyobject-reference",
  "096-memory-real-cipher-state-refusal": "nodejs-resource-cipher-key-reference",
  "107-memory-real-webcrypto-subtle-refusal": "nodejs-resource-webcrypto-algorithm-registry",
  "162-memory-real-secret-config-refusal": "nodejs-resource-secret-config-reference",
  "276-memory-real-crypto-secret-refusal": "nodejs-resource-crypto-secret-reference",
  "303-memory-real-crypto-secrets-refusal": "nodejs-resource-crypto-secret-reference",
  "305-memory-real-credential-cache-refusal": "nodejs-resource-credential-cache-reference",
  "306-memory-real-keyring-handle-refusal": "nodejs-resource-keyring-reference",
  "307-memory-real-sensitive-buffer-refusal": "nodejs-resource-sensitive-buffer-redaction",
  "264-memory-real-active-running-job-refusal": "nodejs-resource-job-retry-policy",
  "266-memory-real-job-lock-refusal": "nodejs-resource-job-lock-release-policy",
  "019-active-request-app": "nodejs-resource-quiesced-active-request",
  "035-memory-pending-promise-refusal": "nodejs-resource-settled-promise-value",
  "049-memory-real-promise-refusal": "nodejs-resource-settled-promise-value",
  "195-memory-real-promise-reaction-refusal": "nodejs-resource-drained-promise-reaction",
  "196-memory-real-microtask-queue-refusal": "nodejs-resource-drained-microtask-queue",
  "197-memory-real-async-function-frame-refusal": "nodejs-resource-settled-async-function-frame",
  "260-memory-real-active-stdin-refusal": "nodejs-resource-drained-stdin",
  "184-memory-real-messageport-refusal": "nodejs-resource-drained-messageport",
  "185-memory-real-broadcastchannel-refusal": "nodejs-resource-drained-broadcastchannel",
  "130-memory-real-sharedarraybuffer-refusal": "nodejs-resource-sharedarraybuffer-quiesced-copy",
  "186-memory-real-atomics-wait-refusal": "nodejs-resource-atomics-no-waiters",
  "187-memory-real-worker-shared-buffer-refusal": "nodejs-resource-worker-shared-buffer-quiesced",
  "067-memory-real-async-context-native-resource-refusal":
    "nodejs-resource-quiesced-async-context-resource",
  "180-memory-real-ffi-handle-refusal": "nodejs-resource-declared-ffi-adapter",
  "308-memory-real-opaque-native-handles-refusal":
    "nodejs-resource-declared-native-resource-adapter",
  "060-memory-real-weakmap-refusal": "nodejs-resource-weakmap-semantic-entries",
  "073-memory-real-weakset-refusal": "nodejs-resource-weakset-semantic-members",
  "074-memory-real-finalization-registry-refusal":
    "nodejs-resource-finalization-registry-drop-policy",
  "075-memory-real-weakref-refusal": "nodejs-resource-weakref-semantic-reference",
  "076-memory-real-gc-sensitive-cache-refusal": "nodejs-resource-gc-sensitive-cache-rebuild-policy",
  "077-memory-real-ephemeron-table-refusal": "nodejs-resource-ephemeron-table-semantic-descriptor",
};
const productResourceEvidencePaths = [
  "proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained/portable-vm-product-node-memory-ir-report.json",
  "proofs/linux-vm-workload/portable-vm-product-node-memory-ir-cross-arch/retained/portable-vm-product-node-memory-ir-cross-arch-report.json",
];

const capabilityBySlug = {
  "plain-http-create-server":
    "Plain node:http listener can restart target-native and verify response",
  express: "Express basic HTTP route shape",
  fastify: "Fastify basic HTTP route shape",
  koa: "Koa basic HTTP middleware shape",
  hono: "Hono basic HTTP route shape",
  "next-minimal-server": "Next minimal server bootstrap shape",
  "remix-react-router-server": "Remix / React Router server bootstrap shape",
  nestjs: "NestJS server bootstrap shape",
  "graphql-apollo": "GraphQL / Apollo HTTP API shape",
  "websocket-server": "WebSocket server startup and active session boundary",
  "sqlite-app": "Clean local SQLite-style state plus HTTP verifier",
  "postgres-app": "Declared clean PostgreSQL external state boundary",
  "static-file-server": "Static file tree served by Node",
  "file-upload-app": "Upload/data directory state served by Node",
  "cron-timer-app": "Declared timer/schedule reconstruction",
  "worker-thread-app": "Worker thread live-state blocker",
  "native-addon-app": "Native addon rebuild / ABI blocker",
  "child-process-app": "Child process tree blocker",
  "active-request-app": "In-flight HTTP request blocker",
  "outbound-connection-app": "Outbound connection/reconnect policy blocker",
  "memory-scalar-counter":
    "Memory-only Node scalar captured from source process memory and reconstructed target-native",
  "memory-plain-object": "Selected V8 plain object state decoded and materialized target-native",
  "memory-array": "Selected packed V8 Smi array state decoded and materialized target-native",
  "memory-closure-context":
    "Selected V8 closure context counter cell decoded and materialized target-native",
  "memory-unsupported-boundaries": "Unsupported V8 memory shapes refuse fail-closed",
  "memory-string": "Selected V8 string state materialized target-native",
  "memory-nested-object-graph": "Selected nested object graph state materialized target-native",
  "memory-shared-references": "Selected shared references preserved in semantic graph IR",
  "memory-cycle": "Selected cyclic object graph preserved in semantic graph IR",
  "memory-map-set": "Selected Map and Set entries materialized target-native",
  "memory-class-instance":
    "Selected class instance data and prototype identity materialized target-native",
  "memory-http-handler-closure-state":
    "Selected HTTP handler closure state materialized target-native",
  "memory-buffer": "Selected internal Buffer bytes materialized target-native",
  "memory-typed-array": "Selected typed array contents materialized target-native",
  "memory-pending-promise-refusal": "Pending Promise and microtask state refuses fail-closed",
  "memory-capture-classifier": "Real guest /proc memory capture classifier for Node/V8 categories",
  "memory-real-plain-object":
    "Selected plain-object state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-array":
    "Selected array state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-closure-context":
    "Selected closure context state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-string":
    "Selected string state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-nested-object-graph":
    "Selected nested object graph captured from source /proc memory and materialized target-native across architectures",
  "memory-real-shared-references":
    "Selected shared-reference graph captured from source /proc memory and materialized target-native across architectures",
  "memory-real-cycle":
    "Selected cyclic graph captured from source /proc memory and materialized target-native across architectures",
  "memory-real-map-set":
    "Selected Map/Set state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-class-instance":
    "Selected class-instance state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-buffer":
    "Selected Buffer bytes captured from source /proc memory and materialized target-native across architectures",
  "memory-real-typed-array":
    "Selected typed-array state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-http-handler-closure-state":
    "Selected HTTP handler closure state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-date-regexp":
    "Selected Date and RegExp semantic state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-error-object":
    "Selected Error object semantic state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-url-searchparams":
    "Selected URL and URLSearchParams semantic state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-bigint-rich-graph":
    "Selected BigInt-rich graph state captured from source /proc memory as tagged semantic values and materialized target-native across architectures",
  "memory-real-module-singleton-state":
    "Selected module-level singleton state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-arraybuffer-dataview":
    "Selected ArrayBuffer and DataView state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-symbol-keyed-object":
    "Selected Symbol-keyed object state captured from source /proc memory as semantic descriptors and materialized target-native across architectures",
  "memory-real-eventemitter-listeners":
    "Selected EventEmitter listener registry state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-in-memory-lru-cache":
    "Selected in-memory LRU cache state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-queue-state":
    "Selected queue state captured from source /proc memory and materialized target-native across architectures",
  "memory-real-weakmap-refusal": "WeakMap key reachability and entries refuse fail-closed",
  "memory-real-timer-refusal": "Active timer queue state refuses fail-closed",
  "memory-real-stream-refusal": "Node stream buffered/native state refuses fail-closed",
  "memory-real-promise-refusal": "Pending Promise and microtask memory state refuses fail-closed",
};

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function evidence(kind, path, summary) {
  return { kind, path, sha256: hashFile(path), summary };
}

function readProductResourceEvidence(rowId) {
  const resourceRowId = productResourceCompatibilityRows[rowId];
  if (!resourceRowId) {
    return undefined;
  }
  const reports = productResourceEvidencePaths
    .filter((path) => existsSync(path))
    .map((path) => ({ path, report: JSON.parse(readFileSync(path, "utf8")) }));
  const single = reports.find(
    ({ report }) =>
      report.accepted === true &&
      report.acceptedPath?.supportedResourceRows?.includes(resourceRowId),
  );
  const cross = reports.find(
    ({ report }) =>
      report.accepted === true &&
      Array.isArray(report.directions) &&
      report.directions.every(
        (direction) =>
          direction.resourceVerified === true &&
          direction.supportedResourceRows?.includes(resourceRowId) &&
          direction.sourceVmPauseBoundary?.pauseMechanism === "vmm-native-sigusr1-sigusr2",
      ),
  );
  if (!single || !cross) {
    return undefined;
  }
  return { resourceRowId, single, cross };
}

function productResourceCell(row, arch) {
  const proof = readProductResourceEvidence(row.id);
  if (!proof) {
    return undefined;
  }
  return {
    status: "verified",
    lastRun: null,
    evidence: [
      evidence(
        "product-resource-ir-report",
        proof.single.path,
        `${proof.resourceRowId} product Resource IR materialized`,
      ),
      evidence(
        "product-resource-ir-cross-arch-report",
        proof.cross.path,
        `${proof.resourceRowId} verified with ${arch} participating in arm64<->amd64 product smoke`,
      ),
    ],
    notes: `Semantic Resource IR row ${proof.resourceRowId} materialized target-native with retained VMM-native pause proof; raw/live/native continuation remains refused.`,
  };
}

function hasProductResourceSupport(row) {
  return readProductResourceEvidence(row.id) !== undefined;
}

function readReports() {
  const retainedMemoryReports = readdirSync(join(root, "retained"))
    .filter((name) => /^nodejs-portability-memory-.*-report\.json$/u.test(name))
    .map((name) => ["memory-state-smoke-report", join(root, "retained", name)]);
  const inputs = [...evidenceInputs, ...retainedMemoryReports].filter(
    ([, path], index, all) => all.findIndex((candidate) => candidate[1] === path) === index,
  );
  return inputs
    .filter(([, path]) => existsSync(path))
    .map(([kind, path]) => ({ kind, path, report: JSON.parse(readFileSync(path, "utf8")) }));
}

function rowDirs() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function attemptPolicy(row) {
  if (hasProductResourceSupport(row)) {
    return "try-first";
  }
  if (row.disposition === "refused-first") {
    return "refuse-live-state";
  }
  if (row.disposition === "supported-with-declared-config") {
    return "config-required";
  }
  return "try-first";
}

function archCell(row, arch, reports) {
  const productResource = productResourceCell(row, arch);
  if (productResource) {
    return productResource;
  }
  const memoryScalar = memoryScalarCell(row, arch, reports);
  if (memoryScalar) {
    return memoryScalar;
  }
  const ev = [
    evidence(
      "classification-report",
      "portability/nodejs/retained/nodejs-portability-corpus-report.json",
      `${arch} classification row retained`,
    ),
  ];
  const runtime = reports.find(
    ({ report }) =>
      Array.isArray(report.architectures) &&
      report.architectures.includes(arch) &&
      report.results?.some((result) => result.id === row.id && result.state === "verified"),
  );
  if (runtime) {
    ev.push(evidence(runtime.kind, runtime.path, `${arch} Machinen runtime verifier passed`));
    return {
      status: "verified",
      lastRun: null,
      evidence: ev,
      notes: "Machinen runtime-controlled VM execution verified this capability.",
    };
  }
  const failed = reports.find(
    ({ report }) =>
      Array.isArray(report.architectures) &&
      report.architectures.includes(arch) &&
      report.results?.some(
        (result) => result.id === row.id && result.state === "failed-classified",
      ),
  );
  if (failed) {
    ev.push(evidence(failed.kind, failed.path, `${arch} retained classified failure`));
    return {
      status: "failed-classified",
      lastRun: null,
      evidence: ev,
      notes: "Attempted and retained with classified failure evidence.",
    };
  }
  const refused = reports.find(
    ({ report }) =>
      Array.isArray(report.architectures) &&
      report.architectures.includes(arch) &&
      report.results?.some((result) => result.id === row.id && result.state === "refused"),
  );
  if (row.disposition === "refused-first") {
    if (refused) {
      ev.push(evidence(refused.kind, refused.path, `${arch} retained refusal smoke`));
    }
    return {
      status: refused ? "verified-refusal" : "refused",
      lastRun: null,
      evidence: ev,
      notes: refused
        ? `Retained fail-closed proof: ${row.refusalCode}`
        : `Untested fail-closed gap: ${row.refusalCode}`,
    };
  }
  if (row.disposition === "supported-with-declared-config") {
    return {
      status: "conditional",
      lastRun: null,
      evidence: ev,
      notes: "Needs declared config/dependencies before runtime execution.",
    };
  }
  return {
    status: "classified",
    lastRun: null,
    evidence: ev,
    notes: "Known capability; runtime execution pending.",
  };
}

function memoryScalarCell(row, arch, reports) {
  if (row.id !== "021-memory-scalar-counter") {
    return undefined;
  }
  const report = reports.find(
    (candidate) =>
      candidate.path ===
      "portability/nodejs/retained/nodejs-portability-memory-scalar-arm64-to-amd64-report.json",
  );
  const ev = [
    evidence(
      "row-manifest",
      "portability/nodejs/021-memory-scalar-counter/portability.json",
      `${arch} memory-scalar row metadata`,
    ),
  ];
  if (report?.report?.accepted === true) {
    ev.push(evidence(report.kind, report.path, "arm64-to-amd64 memory scalar smoke passed"));
    return {
      status: "verified",
      lastRun: null,
      evidence: ev,
      notes:
        arch === "arm64"
          ? "Source memory capture recovered count=41 from guest /proc/<pid>/mem."
          : "Target-native reconstruction verified count 41 -> 42.",
    };
  }
  return {
    status: "classified",
    lastRun: null,
    evidence: ev,
    notes: "Memory-scalar smoke not retained for this architecture pair.",
  };
}

function rowStatus(row, architectures) {
  const cells = Object.values(architectures).map((cell) => cell.status);
  if (cells.every((status) => status === "verified")) {
    return "verified";
  }
  if (cells.every((status) => status === "verified-refusal")) {
    return "verified-refusal";
  }
  if (cells.some((status) => status === "failed-classified")) {
    return "failed-classified";
  }
  if (row.disposition === "refused-first") {
    return "refused";
  }
  if (row.disposition === "supported-with-declared-config") {
    return "conditional";
  }
  return "classified";
}

function blockers(row, status) {
  if (status === "verified-refusal") {
    return [];
  }
  if (row.disposition === "refused-first" && !hasProductResourceSupport(row)) {
    return [
      {
        id: row.slug,
        severity: "hard-blocker",
        description: row.description,
        refusalCode: row.refusalCode,
      },
    ];
  }
  if (status === "failed-classified") {
    return [
      {
        id: "classified-runtime-failure",
        severity: "major",
        description: "A retained runtime attempt failed and was classified.",
        refusalCode: "node-portability-runtime-attempt-failed",
      },
    ];
  }
  if (row.disposition === "supported-with-declared-config") {
    return [
      {
        id: "declared-config-required",
        severity: "minor",
        description:
          "Needs target-native dependency/config/artifact declaration before proof execution.",
        refusalCode: null,
      },
    ];
  }
  if (row.dependencies.length > 0 && status !== "verified") {
    return [
      {
        id: "dependency-install-required",
        severity: "minor",
        description:
          "Needs target-native npm dependency installation during proof/product restore.",
        refusalCode: null,
      },
    ];
  }
  return [];
}

function productClaim(row, status) {
  if (hasProductResourceSupport(row)) {
    return {
      status: "candidate",
      scope: "node-resource-ir-product-proof",
      notes:
        "Supported only as decoded semantic Resource IR with retained VMM-native pause proof; raw/live/native continuation remains refused.",
    };
  }
  if (status === "verified") {
    return {
      status: "candidate",
      scope: "node-portability-corpus-proof",
      notes:
        "VM-verified capability evidence; does not claim arbitrary raw Node process continuation.",
    };
  }
  if (status === "verified-refusal") {
    return {
      status: "verified-refusal",
      scope: "node-portability-fail-closed-proof",
      notes:
        "Retained fail-closed proof covers this unsafe row; live/opaque state is not portable.",
    };
  }
  if (row.disposition === "refused-first") {
    return {
      status: "refusal",
      scope: "node-portability-blocker",
      notes:
        "Stable blocker row; app restart may be separately attempted but live/opaque state is not portable.",
    };
  }
  if (row.disposition === "supported-with-declared-config") {
    return {
      status: "conditional",
      scope: "node-portability-corpus-proof",
      notes: "Requires declared dependencies/config/artifacts before runtime execution.",
    };
  }
  return {
    status: "none",
    scope: "classification-only",
    notes: "Known row, not yet product-claimed.",
  };
}

function uniqueEvidence(items) {
  return items.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.kind === item.kind && candidate.path === item.path) ===
      index,
  );
}

function categoryFor(row) {
  if (categoryBySlug[row.slug]) {
    return categoryBySlug[row.slug];
  }
  if (row.disposition === "refused-first" && row.slug.startsWith("memory-real-")) {
    return "memory-blocker";
  }
  if (row.slug.startsWith("memory-real-")) {
    return "memory-state";
  }
  return "unknown";
}

function buildIndex() {
  const reports = readReports();
  const rows = rowDirs().map((dir) => {
    const row = JSON.parse(readFileSync(join(root, dir, "portability.json"), "utf8"));
    const architectures = {
      arm64: archCell(row, "arm64", reports),
      amd64: archCell(row, "amd64", reports),
    };
    const status = rowStatus(row, architectures);
    return {
      id: row.id,
      slug: row.slug,
      capability: capabilityBySlug[row.slug] ?? row.description,
      category: categoryFor(row),
      description: row.description,
      attemptPolicy: attemptPolicy(row),
      status,
      architectures,
      blockers: blockers(row, status),
      workaround:
        row.disposition === "supported-with-declared-config" && status !== "verified"
          ? "Declare dependencies/config/artifacts and rerun with --install-deps or matching product adapter."
          : status === "refused"
            ? "Add retained fail-closed proof or declare a reconstruction policy before claiming coverage."
            : null,
      productClaim: productClaim(row, status),
      evidence: uniqueEvidence([
        evidence("row-manifest", `portability/nodejs/${row.id}/portability.json`, "row metadata"),
        ...architectures.arm64.evidence,
        ...architectures.amd64.evidence,
      ]),
      claimGuard,
    };
  });
  const byStatus = {};
  const byProductClaim = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byProductClaim[row.productClaim.status] = (byProductClaim[row.productClaim.status] ?? 0) + 1;
  }
  return {
    kind: "machinen.portability-compatibility-index",
    version: 1,
    runtime: "nodejs",
    updatedAt: "2026-06-03",
    claimBoundary: {
      model:
        "caniuse-style compatibility table for arbitrary Node.js application portability dimensions",
      notClaimed: [
        "raw V8 heap restore",
        "raw CPU/process continuation",
        "same PID continuation",
        "active request transfer",
        "active socket stream transfer",
        "source ISA emulation",
      ],
      proofMode: "try broadly, retain successes and failures, classify blockers",
      productMode:
        "claim only verified rows with retained product/runtime evidence and fail-closed blockers",
      claimGuard,
    },
    summary: {
      rowCount: rows.length,
      byStatus,
      byProductClaim,
      architectures: ["arm64", "amd64"],
      verifiedBothArchitectures: rows.filter((row) => row.status === "verified").length,
      verifiedRefusalRows: rows.filter((row) => row.status === "verified-refusal").length,
      refusedRows: rows.filter((row) => row.status === "refused").length,
      unsupportedUnverifiedRows: rows.filter((row) => row.status === "refused").length,
      coveredRows: rows.filter(
        (row) => row.status === "verified" || row.status === "verified-refusal",
      ).length,
      conditionalRows: rows.filter((row) => row.status === "conditional").length,
      failedClassifiedRows: rows.filter((row) => row.status === "failed-classified").length,
    },
    evidenceReports: reports.map(({ kind, path }) => evidence(kind, path, path.split("/").pop())),
    rows,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildRefusalCoverageReport(index) {
  const verifiedRefusals = index.rows.filter((row) => row.status === "verified-refusal");
  const unverifiedRefusals = index.rows.filter((row) => row.status === "refused");
  return {
    kind: "machinen.nodejs-portability-refusal-coverage-report",
    version: 1,
    accepted: unverifiedRefusals.length === 0,
    runtime: "nodejs",
    rowCount: index.rows.length,
    supportedRows: index.rows.filter((row) => row.status === "verified").length,
    verifiedRefusalRows: verifiedRefusals.length,
    unsupportedUnverifiedRows: unverifiedRefusals.length,
    allRowsAccountedFor: index.rows.every(
      (row) => row.status === "verified" || row.status === "verified-refusal",
    ),
    claimGuard,
    notClaimed: index.claimBoundary.notClaimed,
    verifiedRefusals: verifiedRefusals.map((row) => ({
      id: row.id,
      status: row.status,
      refusalCode:
        row.architectures.arm64.notes?.match(/node-portability-[a-z0-9-]+-unsupported/u)?.[0] ??
        null,
      architectures: Object.fromEntries(
        Object.entries(row.architectures).map(([arch, cell]) => [
          arch,
          {
            status: cell.status,
            evidence: cell.evidence.map((item) => ({ kind: item.kind, path: item.path })),
          },
        ]),
      ),
      productClaim: row.productClaim,
    })),
    unverifiedRefusals: unverifiedRefusals.map((row) => ({ id: row.id, status: row.status })),
  };
}

function buildDashboard(index) {
  const rows = index.rows
    .map(
      (row) => `<tr class="status-${row.status}">
<td><a href="${row.id}/">${row.id}</a></td>
<td>${escapeHtml(row.capability)}<div class="muted">${escapeHtml(row.category)} · ${escapeHtml(row.attemptPolicy)}</div></td>
<td><span class="pill ${row.status}">${row.status}</span></td>
<td>${archCellHtml(row, "arm64")}</td>
<td>${archCellHtml(row, "amd64")}</td>
<td>${escapeHtml(row.productClaim.status)}<div class="muted">${escapeHtml(row.productClaim.scope)}</div></td>
<td>${row.blockers.length === 0 ? "—" : row.blockers.map((blocker) => escapeHtml(blocker.refusalCode ?? blocker.id)).join("<br>")}</td>
<td>${row.evidence.map((item) => `<a href="../../${item.path}">${escapeHtml(item.kind)}</a>`).join("<br>")}</td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Machinen Node.js portability compatibility</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #16202a; }
    table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
    th, td { border: 1px solid #d7dee8; padding: 0.55rem; vertical-align: top; }
    th { background: #f4f7fb; text-align: left; }
    .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
    .card { border: 1px solid #d7dee8; border-radius: 0.6rem; padding: 0.8rem 1rem; background: #fbfcfe; }
    .muted { color: #5f6f83; font-size: 0.82rem; margin-top: 0.25rem; }
    .pill { border-radius: 999px; padding: 0.18rem 0.5rem; font-weight: 700; display: inline-block; }
    .verified { background: #dff7e8; color: #0c6830; }
    .classified, .conditional { background: #fff2c6; color: #785a00; }
    .verified-refusal { background: #e8f0ff; color: #234b8f; }
    .failed-classified, .refused { background: #ffe0e0; color: #8a1f1f; }
    code { background: #f4f7fb; padding: 0.12rem 0.25rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>Node.js portability compatibility</h1>
  <p>This is a caniuse-style capability matrix. It is not a claim that arbitrary raw Node processes, V8 heaps, active requests, or sockets resume exactly.</p>
  <div class="cards">
    <div class="card"><strong>${index.summary.rowCount}</strong><div class="muted">rows</div></div>
    <div class="card"><strong>${index.summary.verifiedBothArchitectures}</strong><div class="muted">verified on arm64 + amd64</div></div>
    <div class="card"><strong>${index.summary.verifiedRefusalRows}</strong><div class="muted">verified fail-closed rows</div></div>
    <div class="card"><strong>${index.summary.unsupportedUnverifiedRows}</strong><div class="muted">untested refused rows</div></div>
    <div class="card"><strong>${index.summary.failedClassifiedRows}</strong><div class="muted">failed-classified rows</div></div>
  </div>
  <h2>Claim guard</h2>
  <ul>
    ${index.claimBoundary.notClaimed.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n    ")}
  </ul>
  <table>
    <thead><tr><th>Row</th><th>Capability</th><th>Status</th><th>arm64</th><th>amd64</th><th>Product claim</th><th>Blockers</th><th>Evidence</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <script id="embedded-nodejs-portability-index" type="application/json">
${JSON.stringify(index, null, 2)}
  </script>
</body>
</html>
`;
}

function archCellHtml(row, arch) {
  const cell = row.architectures[arch];
  return `<span class="pill ${cell.status}">${cell.status}</span><div class="muted">${escapeHtml(cell.notes ?? "")}</div>`;
}

const index = buildIndex();
const refusalCoverage = buildRefusalCoverageReport(index);
writeFileSync(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(
  join(root, "retained", "nodejs-portability-refusal-coverage-report.json"),
  `${JSON.stringify(refusalCoverage, null, 2)}\n`,
);
writeFileSync(join(root, "index.html"), buildDashboard(index));
console.log(JSON.stringify(index.summary, null, 2));
