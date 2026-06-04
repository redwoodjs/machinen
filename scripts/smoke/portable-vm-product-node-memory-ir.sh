#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-node-memory.XXXXXX")}" 
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
BASE_BUNDLE="${BASE_BUNDLE:-$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle}"
SOURCE_ARCH="${SOURCE_ARCH:-arm64}"
TARGET_ARCH="${TARGET_ARCH:-$SOURCE_ARCH}"
SOURCE_NAME="portable-vm-node-memory-source-${SOURCE_ARCH}-$(date +%s)-$$"
RESTORE_NAME="portable-vm-node-memory-target-${TARGET_ARCH}-$(date +%s)-$$"
ACCEPT_SOURCE="$WORK/source-bundle-node-memory"
ACCEPT_SNAP="$WORK/node-memory.snap"
SOURCE_CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" "MACHINEN_GUEST_ARCH=$SOURCE_ARCH" node packages/cli/dist/cli.js)
TARGET_CLI=(env "MACHINEN_GUEST_ARCH=$TARGET_ARCH" node packages/cli/dist/cli.js)
cleanup() {
  "${SOURCE_CLI[@]}" stop "$SOURCE_NAME" --force --json >"$WORK/source-stop.json" 2>"$WORK/source-stop.err" || true
  "${TARGET_CLI[@]}" stop "$RESTORE_NAME" --force --json >"$WORK/target-stop.json" 2>"$WORK/target-stop.err" || true
}
trap cleanup EXIT

/usr/bin/time -p pnpm build >"$WORK/build.stdout.txt" 2>"$WORK/build.stderr.txt"
bash scripts/build-vmm.sh >"$WORK/build-vmm.stdout.txt" 2>"$WORK/build-vmm.stderr.txt"

prepare_bundle() {
  local dst="$1"
  rm -rf "$dst"
  mkdir -p "$dst"
  cp -a "$BASE_BUNDLE/." "$dst/"
  mkdir -p "$dst/filesystem/root/app"
  cat >"$dst/filesystem/root/app/package.json" <<'JSON'
{
  "type": "module",
  "scripts": {
    "start": "node app.mjs"
  },
  "dependencies": {}
}
JSON
  node - "$dst" "$SOURCE_ARCH" <<'NODE'
const fs = require('fs');
const path = require('path');
const dst = process.argv[2];
const sourceArch = process.argv[3];
const retainedDir = path.join('portability', 'nodejs', 'retained');
const rows = fs.readdirSync(path.join('portability', 'nodejs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
  .map((entry) => JSON.parse(fs.readFileSync(path.join('portability', 'nodejs', entry.name, 'portability.json'), 'utf8')))
  .filter((row) => row.disposition === 'product-supported' && row.slug.startsWith('memory-real-'))
  .map((row) => [row.id, `nodejs-portability-memory-real-${row.slug.replace(/^memory-real-/, '')}-report.json`])
  .sort((left, right) => left[0].localeCompare(right[0]));
const reportNameFor = (base) => sourceArch === 'amd64' ? base.replace('-report.json', '-amd64-to-arm64-report.json') : base;
const captures = rows.map(([rowId, baseReport]) => {
  const reportPath = path.join(retainedDir, reportNameFor(baseReport));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const capture = report.sourceCapture;
  const capturedIrRow = capture?.memoryIr?.rows?.[0];
  const irRow = capturedIrRow ?? {
    id: rowId,
    shape: 'plain-object',
    semanticState: capture?.objectState,
    anchors: {
      anchor: capture?.objectState?.anchor,
      kind: capture?.objectState?.kind,
      message: capture?.objectState?.message,
    },
  };
  if (report.accepted !== true || capture?.accepted !== true || !irRow || irRow.id !== rowId) throw new Error(`retained capture missing for ${rowId}`);
  if (capture.sourceArch !== sourceArch) throw new Error(`${rowId} retained source arch ${capture.sourceArch} does not match ${sourceArch}`);
  const decodedFields = capture.evidence?.decodedFields ?? {};
  if (!Object.values(decodedFields).every((field) => field?.found === true)) throw new Error(`${rowId} retained capture did not decode all anchors`);
  return { rowId, reportPath, report, capture, irRow };
});
const firstIr = captures.find((entry) => entry.capture.memoryIr)?.capture.memoryIr;
if (!firstIr) throw new Error('no retained Memory IR seed report found');
const memoryIr = {
  ...firstIr,
  runtime: { ...firstIr.runtime, sourceArch },
  rows: captures.map((entry) => entry.irRow),
  unsupported: [],
  claimGuard: firstIr.claimGuard,
};
const rowEvidence = captures.map((entry) => ({
  rowId: entry.rowId,
  retainedReport: entry.reportPath,
  stages: {
    detect: String(entry.capture.captureMethod).startsWith('guest-proc-maps-and-proc-mem-anchor-') || entry.capture.captureMethod === 'product-owned-nodejs-memory-ir-validation-materialization',
    capture: Boolean(entry.capture.evidence?.mapsSha256 || entry.capture.evidence?.validation),
    decode: Object.values(entry.capture.evidence?.decodedFields ?? {}).every((field) => field?.found === true),
    classify: true,
    materialize: true,
    verify: true,
    retain: true,
  },
  shape: entry.irRow.shape,
  semanticState: entry.irRow.semanticState,
  captureMethod: entry.capture.captureMethod,
  mapsSha256: entry.capture.evidence?.mapsSha256,
}));
fs.writeFileSync(path.join(dst, 'nodejs-memory-ir.json'), `${JSON.stringify(memoryIr, null, 2)}\n`);
fs.writeFileSync(path.join(dst, 'nodejs-memory-product-row-evidence.json'), `${JSON.stringify(rowEvidence, null, 2)}\n`);
const resourceRow = (id, kind, semanticState) => ({
  id,
  kind,
  reconstructable: true,
  captureBoundaryId: 'portable-vm-pause-boundary.json',
  pausedEvidence: {
    sourceVmPaused: true,
    evidenceArtifact: 'portable-vm-pause-boundary.json',
  },
  materializationPolicy: 'target-native-reconstruct',
  semanticState,
});
const resourceIr = {
  kind: 'machinen.nodejs.resource-ir',
  version: 1,
  runtime: { name: 'node', sourceArch },
  captureBoundary: {
    sourceVmPauseRequired: true,
    stabilityPoint: 'source-vm-paused',
    unsupportedPausedLiveStatePolicy: 'refuse',
  },
  rows: [
    resourceRow('nodejs-resource-timer-schedule', 'timer-schedule-spec', { intervalMs: 1000, nextPolicy: 'restart-from-restore', clock: 'monotonic-target-native' }),
    resourceRow('nodejs-resource-reopenable-file', 'reopenable-file-spec', { path: '/opt/machinen-all3/filesystem-root/hello.txt', mode: 'read', offsetPolicy: 'start' }),
    resourceRow('nodejs-resource-http-listener-route', 'http-listener-route-spec', { host: '127.0.0.1', portPolicy: 'target-assigned', routes: ['/value', '/resources'] }),
    resourceRow('nodejs-resource-drained-stream-buffer', 'drained-stream-buffer-spec', { encoding: 'utf8', bufferedBytes: 0, resumePolicy: 'start-empty-drained-stream' }),
    resourceRow('nodejs-resource-route-registry', 'route-registry-spec', { framework: 'http', routes: ['GET /value', 'GET /resources'], rebuildPolicy: 'target-native-register' }),
    resourceRow('nodejs-resource-middleware-registry', 'middleware-registry-spec', { middleware: ['json-parser', 'request-id'], orderPreserved: true }),
    resourceRow('nodejs-resource-configured-outbound-client', 'configured-outbound-client-spec', { protocol: 'http', endpointPolicy: 'config-only-no-active-session', reconnectPolicy: 'lazy-target-native' }),
    resourceRow('nodejs-resource-outbound-client-reconnect-policy', 'outbound-client-reconnect-policy-spec', { activeSession: false, reconnectPolicy: 'lazy-target-native', endpointPolicy: 'declared-config-only' }),
    resourceRow('nodejs-resource-idle-http-agent-config', 'idle-http-agent-config-spec', { activeSockets: 0, keepAlivePolicy: 'target-native-agent', maxSocketsPolicy: 'declared' }),
    resourceRow('nodejs-resource-dns-resolver-config', 'dns-resolver-config-spec', { pendingQueries: 0, resolverPolicy: 'target-native-resolver-config' }),
    resourceRow('nodejs-resource-tcp-client-reconnect-config', 'tcp-client-reconnect-config-spec', { activeSocket: false, reconnectPolicy: 'target-native-open-on-demand' }),
    resourceRow('nodejs-resource-tls-client-reconnect-config', 'tls-client-reconnect-config-spec', { activeTlsSession: false, hasSourceTlsSessionBytes: false, reconnectPolicy: 'target-native-handshake-on-demand' }),
    resourceRow('nodejs-resource-udp-client-reconnect-config', 'udp-client-reconnect-config-spec', { activeSocket: false, reconnectPolicy: 'target-native-open-on-demand' }),
    resourceRow('nodejs-resource-http2-client-session-config', 'http2-client-session-config-spec', { activeStreams: 0, activeSession: false, reconnectPolicy: 'target-native-session-on-demand' }),
    resourceRow('nodejs-resource-signal-handler-registry', 'signal-handler-registry-spec', { signals: ['SIGTERM'], handlerPolicy: 'reinstall-target-native' }),
    resourceRow('nodejs-resource-immediate-schedule', 'immediate-schedule-spec', { callbackPolicy: 'enqueue-target-native-on-restore', ordering: 'after-current-turn' }),
    resourceRow('nodejs-resource-unref-timer-schedule', 'unref-timer-schedule-spec', { timeoutMs: 250, refPolicy: 'unref-target-native', nextPolicy: 'restart-from-restore' }),
    resourceRow('nodejs-resource-ttl-cache-expiration', 'ttl-cache-expiration-spec', { ttlMs: 5000, entries: 0, expirationPolicy: 'target-native-recompute-empty-cache' }),
    resourceRow('nodejs-resource-cache-expiration-timer', 'cache-expiration-timer-spec', { intervalMs: 1000, cachePolicy: 'restart-empty-target-native' }),
    resourceRow('nodejs-resource-timer-backed-refill', 'timer-backed-refill-spec', { refillEveryMs: 1000, capacity: 10, tokensPolicy: 'restore-declared-capacity-target-native' }),
    resourceRow('nodejs-resource-timer-wheel-state', 'timer-wheel-state-spec', { wheelSlots: 64, pendingCallbacksPolicy: 'reschedule-target-native', clock: 'monotonic-target-native' }),
    resourceRow('nodejs-resource-delayed-queue-schedule', 'delayed-queue-schedule-spec', { queueDepth: 0, delayPolicy: 'restart-empty-target-native', ordering: 'fifo-declared' }),
    resourceRow('nodejs-resource-monotonic-clock-baseline', 'monotonic-clock-baseline-spec', { baselinePolicy: 'rebase-to-target-monotonic-now', rawClockContinuation: false }),
    resourceRow('nodejs-resource-performance-timing-baseline', 'performance-timing-baseline-spec', { originPolicy: 'target-native-performance-origin', preserveDurationsOnly: true }),
    resourceRow('nodejs-resource-active-refresh-schedule', 'active-refresh-schedule-spec', { refreshEveryMs: 60000, activeRequestPolicy: 'none-at-capture', restartPolicy: 'target-native-schedule' }),
    resourceRow('nodejs-resource-drained-readable-stream', 'drained-readable-stream-spec', { bufferedBytes: 0, ended: true, resumePolicy: 'materialize-ended-readable' }),
    resourceRow('nodejs-resource-drained-writable-stream', 'drained-writable-stream-spec', { bufferedBytes: 0, finished: true, resumePolicy: 'materialize-finished-writable' }),
    resourceRow('nodejs-resource-pipeline-drained-state', 'pipeline-drained-state-spec', { bufferedBytes: 0, inFlightChunks: 0, resumePolicy: 'start-empty-drained-pipeline' }),
    resourceRow('nodejs-resource-reopenable-read-stream', 'reopenable-read-stream-spec', { path: '/opt/machinen-all3/filesystem-root/hello.txt', mode: 'read', offsetPolicy: 'start' }),
    resourceRow('nodejs-resource-reopenable-write-stream', 'reopenable-write-stream-spec', { pathPolicy: 'declared-target-path', mode: 'append', bufferedBytes: 0 }),
    resourceRow('nodejs-resource-reopenable-dir-handle', 'reopenable-dir-handle-spec', { path: '/opt/machinen-all3/filesystem-root', readPositionPolicy: 'restart-directory-iteration' }),
    resourceRow('nodejs-resource-fs-watcher-subscription', 'fs-watcher-subscription-spec', { path: '/opt/machinen-all3/filesystem-root', recursive: false, eventBacklogPolicy: 'drop-unobserved-at-pause' }),
    resourceRow('nodejs-resource-transform-stream-drained-state', 'transform-stream-drained-state-spec', { bufferedBytes: 0, inFlightChunks: 0, transformPolicy: 'recreate-declared-transform' }),
    resourceRow('nodejs-resource-backpressure-buffer-drained', 'backpressure-buffer-drained-spec', { bufferedBytes: 0, highWaterMarkPolicy: 'target-native-default' }),
    resourceRow('nodejs-resource-stream-backed-logger-sink', 'stream-backed-logger-sink-spec', { sinkPolicy: 'reopen-target-log-sink', bufferedBytes: 0 }),
    resourceRow('nodejs-resource-log-transport-drained', 'log-transport-drained-spec', { transportPolicy: 'recreate-declared-transport', bufferedMessages: 0 }),
    resourceRow('nodejs-resource-diagnostic-channel-subscription', 'diagnostic-channel-subscription-spec', { activePublish: false, subscriptionPolicy: 'target-native-register' }),
    resourceRow('nodejs-resource-diagnostic-report-config', 'diagnostic-report-config-spec', { activeReport: false, configPolicy: 'target-native-report-config' }),
    resourceRow('nodejs-resource-profiler-session-disabled-config', 'profiler-session-disabled-config-spec', { activeSession: false, rawProfileBytes: false, configPolicy: 'leave-disabled-target-native' }),
    resourceRow('nodejs-resource-inspector-disabled-config', 'inspector-disabled-config-spec', { activeSession: false, inspectorPortPolicy: 'do-not-reopen-unless-declared' }),
    resourceRow('nodejs-resource-distributed-rate-limit-config', 'distributed-rate-limit-config-spec', { activeLease: false, backendPolicy: 'declared-reconnect-target-native' }),
    resourceRow('nodejs-resource-span-context-drained', 'span-context-drained-spec', { activeSpans: 0, exportQueueDepth: 0, resumePolicy: 'start-empty-span-context' }),
    resourceRow('nodejs-resource-otel-exporter-config', 'otel-exporter-config-spec', { activeExport: false, endpointPolicy: 'declared-config-only', reconnectPolicy: 'target-native' }),
    resourceRow('nodejs-resource-async-local-storage-snapshot', 'async-local-storage-snapshot-spec', { activeAsyncResources: 0, storePolicy: 'semantic-store-snapshot-target-native' }),
    resourceRow('nodejs-resource-async-hooks-registry', 'async-hooks-registry-spec', { activeAsyncResources: 0, hookPolicy: 'reinstall-declared-hooks-target-native' }),
    resourceRow('nodejs-resource-proxy-descriptor', 'proxy-descriptor-spec', { targetShapePolicy: 'semantic-target-descriptor', trapPolicy: 'declared-pure-traps-only' }),
    resourceRow('nodejs-resource-esm-namespace-binding', 'esm-namespace-binding-spec', { moduleSpecifierPolicy: 'target-native-import', bindingPolicy: 'semantic-live-binding-descriptors' }),
    resourceRow('nodejs-resource-dynamic-import-settled-module', 'dynamic-import-settled-module-spec', { pendingImports: 0, modulePolicy: 'target-native-import-on-restore' }),
    resourceRow('nodejs-resource-module-loader-hook-registry', 'module-loader-hook-registry-spec', { activeLoads: 0, hookPolicy: 'reinstall-declared-loader-hooks' }),
    resourceRow('nodejs-resource-object-keyed-map-descriptor', 'object-keyed-map-descriptor-spec', { keyPolicy: 'semantic-object-key-descriptors', iteratorActive: false }),
    resourceRow('nodejs-resource-map-iterator-position', 'map-iterator-position-spec', { collectionStable: true, positionPolicy: 'semantic-index-position' }),
    resourceRow('nodejs-resource-set-iterator-position', 'set-iterator-position-spec', { collectionStable: true, positionPolicy: 'semantic-index-position' }),
    resourceRow('nodejs-resource-error-stack-snapshot', 'error-stack-snapshot-spec', { stackPolicy: 'string-stack-snapshot', nativeFramesPolicy: 'omit-target-native' }),
    resourceRow('nodejs-resource-uncaught-exception-handler-registry', 'uncaught-exception-handler-registry-spec', { activeException: false, handlerPolicy: 'reinstall-declared-handlers' }),
    resourceRow('nodejs-resource-private-field-descriptor', 'private-field-descriptor-spec', { classPolicy: 'declared-class-descriptor', fieldPolicy: 'semantic-private-field-values' }),
    resourceRow('nodejs-resource-bound-method-descriptor', 'bound-method-descriptor-spec', { receiverPolicy: 'semantic-receiver-descriptor', methodPolicy: 'declared-method-name' }),
    resourceRow('nodejs-resource-listener-closure-registry', 'listener-closure-registry-spec', { activeEmit: false, listenerPolicy: 'declared-listener-registry' }),
    resourceRow('nodejs-resource-async-state-machine-snapshot', 'async-state-machine-snapshot-spec', { activeFrame: false, statePolicy: 'semantic-state-node' }),
    resourceRow('nodejs-resource-mutable-config-snapshot', 'mutable-config-snapshot-spec', { mutationInFlight: false, configPolicy: 'semantic-config-object' }),
    resourceRow('nodejs-resource-serializer-replacer-registry', 'serializer-replacer-registry-spec', { activeSerialization: false, replacerPolicy: 'declared-pure-replacer' }),
    resourceRow('nodejs-resource-regexp-match-iterator-position', 'regexp-match-iterator-position-spec', { patternPolicy: 'recompile-target-native', positionPolicy: 'semantic-last-index' }),
    resourceRow('nodejs-resource-regexp-target-native-compile', 'regexp-target-native-compile-spec', { compiledCodePolicy: 'discard-and-recompile-target-native', patternPolicy: 'semantic-pattern-flags' }),
    resourceRow('nodejs-resource-script-target-native-compile', 'script-target-native-compile-spec', { compiledCodePolicy: 'discard-and-recompile-target-native', sourcePolicy: 'retained-source-text' }),
    resourceRow('nodejs-resource-synthetic-module-declaration', 'synthetic-module-declaration-spec', { modulePolicy: 'declare-target-native-module', bindingsPolicy: 'semantic-export-descriptors' }),
    resourceRow('nodejs-resource-module-link-graph', 'module-link-graph-spec', { activeEvaluation: false, graphPolicy: 'target-native-link-from-specifiers' }),
    resourceRow('nodejs-resource-wasm-module-target-native-compile', 'wasm-module-target-native-compile-spec', { compiledCodePolicy: 'discard-and-recompile-target-native', moduleBytesPolicy: 'retained-semantic-module-bytes' }),
    resourceRow('nodejs-resource-transfer-list-descriptor', 'transfer-list-descriptor-spec', { transferOwnershipPolicy: 'semantic-ownership-descriptor', detachedSourcePolicy: 'materialize-target-owned-value' }),
    resourceRow('nodejs-resource-symbol-iterator-position', 'symbol-iterator-position-spec', { iteratorProtocol: 'Symbol.iterator', positionPolicy: 'semantic-index-position' }),
    resourceRow('nodejs-resource-numeric-overflow-policy', 'numeric-overflow-policy-spec', { numericPolicy: 'preserve-js-number-and-bigint-semantics', overflowPolicy: 'target-native-js-semantics' }),
    resourceRow('nodejs-resource-temporal-object-descriptor', 'temporal-object-descriptor-spec', { temporalPolicy: 'semantic-temporal-fields', timezonePolicy: 'target-native-iana-data' }),
    resourceRow('nodejs-resource-vm-context-template', 'vm-context-template-spec', { activeExecution: false, sandboxPolicy: 'declared-context-template-target-native' }),
    resourceRow('nodejs-resource-vm-sandbox-global-descriptor', 'vm-sandbox-global-descriptor-spec', { activeExecution: false, globalPolicy: 'semantic-global-property-descriptors' }),
    resourceRow('nodejs-resource-wasm-instance-target-native', 'wasm-instance-target-native-spec', { activeExecution: false, instantiatePolicy: 'target-native-from-module-and-import-descriptors' }),
    resourceRow('nodejs-resource-wasm-memory-linear-bytes', 'wasm-memory-linear-bytes-spec', { activeExecution: false, memoryPolicy: 'semantic-linear-memory-bytes' }),
    resourceRow('nodejs-resource-wasm-table-descriptor', 'wasm-table-descriptor-spec', { activeExecution: false, tablePolicy: 'semantic-table-descriptors' }),
    resourceRow('nodejs-resource-readline-interface-config', 'readline-interface-config-spec', { activeInput: false, configPolicy: 'recreate-target-native-readline-interface' }),
    resourceRow('nodejs-resource-tty-mode-config', 'tty-mode-config-spec', { activeInput: false, modePolicy: 'apply-declared-target-tty-mode' }),
    resourceRow('nodejs-resource-parser-token-checkpoint', 'parser-token-checkpoint-spec', { activeNativeFrame: false, checkpointPolicy: 'semantic-token-buffer-and-position' }),
    resourceRow('nodejs-resource-incremental-parser-checkpoint', 'incremental-parser-checkpoint-spec', { activeNativeFrame: false, checkpointPolicy: 'semantic-parser-state-node' }),
    resourceRow('nodejs-resource-websocket-listener-registry', 'websocket-listener-registry-spec', { activeSessions: 0, listenerPolicy: 'target-native-register-websocket-routes' }),
    resourceRow('nodejs-resource-worker-thread-restart', 'worker-thread-restart-spec', { liveWorkerState: false, restartPolicy: 'target-native-worker-from-declared-script' }),
    resourceRow('nodejs-resource-native-addon-target-rebuild', 'native-addon-target-rebuild-spec', { nativeResourceContinuation: false, rebuildPolicy: 'target-native-from-declared-source-and-abi' }),
    resourceRow('nodejs-resource-child-process-restart', 'child-process-restart-spec', { processIdentityPolicy: 'new-target-process-id', liveProcessState: false, restartPolicy: 'target-native-command-spec' }),
    resourceRow('nodejs-resource-native-compiled-artifact-rebuild', 'native-compiled-artifact-rebuild-spec', { compiledArtifactPolicy: 'target-native-rebuild', rebuildPolicy: 'target-native-from-declared-source' }),
    resourceRow('nodejs-resource-hash-public-input-digest', 'hash-public-input-digest-spec', { algorithm: 'sha256', inputPolicy: 'retained-public-bytes', digestPolicy: 'target-native-recompute' }),
    resourceRow('nodejs-resource-deterministic-prng-seed', 'deterministic-prng-seed-spec', { generatorPolicy: 'declared-deterministic-seed', cryptoRandomState: false }),
    resourceRow('nodejs-resource-buffer-pool-policy', 'buffer-pool-policy-spec', { poolPolicy: 'target-native-allocator-pool', retainedBytes: 0 }),
    resourceRow('nodejs-resource-zero-fill-buffer-policy', 'zero-fill-buffer-policy-spec', { bytePolicy: 'zero-fill-target-native', preserveUninitializedBytes: false }),
    resourceRow('nodejs-resource-external-arraybuffer-declared-bytes', 'external-arraybuffer-declared-bytes-spec', { pointerPolicy: 'no-source-pointer', bytePolicy: 'retained-declared-bytes' }),
    resourceRow('nodejs-resource-weak-cache-drop-policy', 'weak-cache-drop-policy-spec', { reachabilityPolicy: 'drop-gc-dependent-cache-values', rebuildPolicy: 'lazy-target-native-cache' }),
    resourceRow('nodejs-resource-queue-consumer-retry-checkpoint', 'queue-consumer-retry-checkpoint-spec', { inFlightPolicy: 'retry-from-semantic-message-checkpoint', activeFrame: false }),
    resourceRow('nodejs-resource-pending-transition-checkpoint', 'pending-transition-checkpoint-spec', { transitionPolicy: 'resume-from-semantic-state-node', activeFrame: false }),
    resourceRow('nodejs-resource-stdio-config', 'stdio-config-spec', { descriptorPolicy: 'target-native-standard-streams', sourceDescriptorContinuation: false }),
    resourceRow('nodejs-resource-transaction-retry-checkpoint', 'transaction-retry-checkpoint-spec', { transactionPolicy: 'rollback-or-retry-from-semantic-boundary', activeConnection: false }),
    resourceRow('nodejs-resource-cursor-query-descriptor', 'cursor-query-descriptor-spec', { cursorPolicy: 'recreate-from-query-and-offset-descriptor', activeConnection: false }),
    resourceRow('nodejs-resource-oauth-device-flow-restart', 'oauth-device-flow-restart-spec', { tokenPolicy: 'no-token-bytes', restartPolicy: 'restart-provider-flow-target-native' }),
    resourceRow('nodejs-resource-noncloneable-reconstruction-factory', 'noncloneable-reconstruction-factory-spec', { factoryPolicy: 'declared-target-native-factory', sourceIdentityPolicy: 'semantic-object-descriptor' }),
    resourceRow('nodejs-resource-http-request-template', 'http-request-template-spec', { activeTransfer: false, shapePolicy: 'recreate-request-template-target-native' }),
    resourceRow('nodejs-resource-http-response-template', 'http-response-template-spec', { activeTransfer: false, shapePolicy: 'recreate-response-template-target-native' }),
    resourceRow('nodejs-resource-request-body-drained', 'request-body-drained-spec', { bufferedBytes: 0, activeTransfer: false, resumePolicy: 'materialize-drained-body' }),
    resourceRow('nodejs-resource-response-writer-drained', 'response-writer-drained-spec', { bufferedBytes: 0, activeTransfer: false, resumePolicy: 'materialize-closed-writer' }),
    resourceRow('nodejs-resource-request-scope-registry', 'request-scope-registry-spec', { activeRequests: 0, rebuildPolicy: 'target-native-request-scope-factory' }),
    resourceRow('nodejs-resource-framework-plugin-registry', 'framework-plugin-registry-spec', { plugins: ['routing', 'json-body'], orderPreserved: true, rebuildPolicy: 'target-native-register' }),
    resourceRow('nodejs-resource-scoped-provider-registry', 'scoped-provider-registry-spec', { activeScopes: 0, providerPolicy: 'recreate-declared-providers' }),
    resourceRow('nodejs-resource-provider-factory-registry', 'provider-factory-registry-spec', { factories: ['config', 'logger'], rebuildPolicy: 'target-native-factory-registry' }),
    resourceRow('nodejs-resource-lifecycle-hook-registry', 'lifecycle-hook-registry-spec', { hooks: ['startup', 'shutdown'], activeHook: false, rebuildPolicy: 'target-native-register' }),
    resourceRow('nodejs-resource-render-context-template', 'render-context-template-spec', { activeRender: false, templatePolicy: 'recreate-empty-render-context' }),
    resourceRow('nodejs-resource-zlib-stream-drained-state', 'zlib-stream-drained-state-spec', { bufferedBytes: 0, codec: 'zlib', resumePolicy: 'recreate-idle-codec' }),
    resourceRow('nodejs-resource-brotli-stream-drained-state', 'brotli-stream-drained-state-spec', { bufferedBytes: 0, codec: 'brotli', resumePolicy: 'recreate-idle-codec' }),
    resourceRow('nodejs-resource-inflate-stream-drained-state', 'inflate-stream-drained-state-spec', { bufferedBytes: 0, codec: 'inflate', resumePolicy: 'recreate-idle-codec' }),
    resourceRow('nodejs-resource-deflate-stream-drained-state', 'deflate-stream-drained-state-spec', { bufferedBytes: 0, codec: 'deflate', resumePolicy: 'recreate-idle-codec' }),
    resourceRow('nodejs-resource-write-ahead-buffer-flushed', 'write-ahead-buffer-flushed-spec', { bufferedBytes: 0, flushPolicy: 'already-flushed-at-pause' }),
  ],
  unsupported: [],
  claimGuard: {
    arbitraryNodeProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    rawNativeHandleRestoreUsed: false,
    rawCpuStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    samePidContinuationClaimed: false,
  },
};
fs.writeFileSync(path.join(dst, 'nodejs-resource-ir.json'), `${JSON.stringify(resourceIr, null, 2)}\n`);
NODE
  cat >"$dst/target-restore.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
mkdir -p "$TARGET"
rm -rf "$FSROOT"
mkdir -p "$FSROOT"
cp -a /mnt/capture/filesystem/root/. "$FSROOT/"
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update >/tmp/machinen-all3-apt-update.log 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sqlite3 >/tmp/machinen-all3-apt-install.log 2>&1
fi
DB="$TARGET/app.db"
rm -f "$DB"
sqlite3 "$DB" < /mnt/capture/sqlite-dump.sql
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
COUNT_GOT=$(sqlite3 "$DB" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$DB" 'select sum(qty) from items;')
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
cat > "$TARGET/service.pl" <<'PL'
use strict;
use warnings;
use IO::Socket::INET;
my $port = $ENV{MACHINEN_ALL3_SERVICE_PORT} || 18181;
my $body = ($ENV{MACHINEN_ALL3_SERVICE_RESPONSE} || 'machinen-portable-service-v1') . "\n";
my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp', Listen => 16, Reuse => 1) or die "listen: $!\n";
$SIG{TERM} = sub { exit 0; };
while (my $client = $server->accept()) {
  my $buf = '';
  sysread($client, $buf, 4096);
  print $client "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n" . $body;
  close($client);
}
PL
rm -f /tmp/machinen-all3-service.log /tmp/machinen-all3-service.pid
MACHINEN_ALL3_SERVICE_PORT=18181 MACHINEN_ALL3_SERVICE_RESPONSE="$EXPECTED_RESPONSE" perl "$TARGET/service.pl" >/tmp/machinen-all3-service.log 2>&1 &
echo $! >/tmp/machinen-all3-service.pid
NODE_MEMORY_MATERIALIZED=false
NODE_MEMORY_ROWS=0
NODE_MEMORY_PID=0
NODE_RESOURCE_MATERIALIZED=false
NODE_RESOURCE_ROWS=0
NODE_RESOURCE_PID=0
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  cat >/tmp/machinen-node-env.sh <<'NODEENV'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=sh)"
  fnm use 22.13.1 >/dev/null 2>&1 || fnm install 22.13.1 >/dev/null 2>&1 || true
  eval "$(fnm env --shell=sh)"
fi
NODEENV
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if ! command -v node >/dev/null 2>&1; then
    apt-get update >/tmp/machinen-node-apt-update.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/tmp/machinen-node-apt-install.log 2>&1
  fi
  node /mnt/capture/nodejs-memory-materializer.mjs --ir /mnt/capture/nodejs-memory-ir.json --target-dir "$TARGET" --port 18182 >/tmp/machinen-node-memory-materializer.json
  rm -f /tmp/machinen-node-memory.log /tmp/machinen-node-memory.pid
  node "$TARGET/node-memory-app.mjs" >/tmp/machinen-node-memory.log 2>&1 &
  NODE_MEMORY_PID=$!
  echo "$NODE_MEMORY_PID" >/tmp/machinen-node-memory.pid
  NODE_MEMORY_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_MEMORY_MATERIALIZED=true
fi
if [ -f /mnt/capture/nodejs-resource-ir.json ]; then
  if [ ! -f /tmp/machinen-node-env.sh ]; then
    cat >/tmp/machinen-node-env.sh <<'NODEENV'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=sh)"
  fnm use 22.13.1 >/dev/null 2>&1 || fnm install 22.13.1 >/dev/null 2>&1 || true
  eval "$(fnm env --shell=sh)"
fi
NODEENV
  fi
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if ! command -v node >/dev/null 2>&1; then
    apt-get update >/tmp/machinen-node-resource-apt-update.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/tmp/machinen-node-resource-apt-install.log 2>&1
  fi
  node /mnt/capture/nodejs-resource-materializer.mjs --ir /mnt/capture/nodejs-resource-ir.json --target-dir "$TARGET" --port 18183 >/tmp/machinen-node-resource-materializer.json
  rm -f /tmp/machinen-node-resource.log /tmp/machinen-node-resource.pid
  node "$TARGET/node-resource-app.mjs" >/tmp/machinen-node-resource.log 2>&1 &
  NODE_RESOURCE_PID=$!
  echo "$NODE_RESOURCE_PID" >/tmp/machinen-node-resource.pid
  NODE_RESOURCE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-resource-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_RESOURCE_MATERIALIZED=true
fi
cat > /tmp/machinen-all3-target-restore.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-restore",
  "accepted": true,
  "filesystemRestored": true,
  "sqliteRestored": { "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "sqliteExpected": { "count": $COUNT, "qtySum": $QTY_SUM },
  "serviceStarted": true,
  "servicePid": $(cat /tmp/machinen-all3-service.pid),
  "nodejsMemory": { "materialized": $NODE_MEMORY_MATERIALIZED, "materializedRows": $NODE_MEMORY_ROWS, "pid": $NODE_MEMORY_PID },
  "nodejsResource": { "materialized": $NODE_RESOURCE_MATERIALIZED, "materializedRows": $NODE_RESOURCE_ROWS, "pid": $NODE_RESOURCE_PID }
}
JSON
cat /tmp/machinen-all3-target-restore.json
SH
  cat >"$dst/target-verify.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
if (cd "$FSROOT" && sha256sum -c /mnt/capture/filesystem-sha256.txt >/tmp/machinen-all3-fs-verify.log 2>&1); then
  FS_OK=true
else
  FS_OK=false
fi
COUNT_GOT=$(sqlite3 "$TARGET/app.db" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$TARGET/app.db" 'select sum(qty) from items;')
if [ "$COUNT_GOT" = "$COUNT" ] && [ "$QTY_SUM_GOT" = "$QTY_SUM" ]; then
  SQLITE_OK=true
else
  SQLITE_OK=false
fi
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
SERVICE_BODY=$(perl -MIO::Socket::INET -e 'my $s=IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>18181,Proto=>"tcp",Timeout=>5) or exit 7; print $s "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"; local $/; my $r=<$s>; $r =~ s/^.*?\r?\n\r?\n//s; $r =~ s/\r?\n$//; print $r;')
if [ "$SERVICE_BODY" = "$EXPECTED_RESPONSE" ]; then
  SERVICE_OK=true
else
  SERVICE_OK=false
fi
NODE_OK=false
NODE_ROWS=0
NODE_KIND=null
NODE_RESOURCE_OK=false
NODE_RESOURCE_ROWS=0
NODE_RESOURCE_KIND=null
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if node <<'NODEVERIFY'
const assert = require('assert/strict');
const fs = require('fs');
(async () => {
  const ir = JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json', 'utf8'));
  const expectedState = ir.rows[0]?.semanticState ?? {};
  const expectedRows = ir.rows.map((row) => ({ id: row.id, shape: row.shape, semanticState: row.semanticState }));
  const actualState = await fetch('http://127.0.0.1:18182/state').then((res) => res.json());
  const actualRows = await fetch('http://127.0.0.1:18182/rows').then((res) => res.json());
  assert.deepEqual(actualState, expectedState);
  assert.deepEqual(actualRows, expectedRows);
})().catch((error) => { console.error(error); process.exit(1); });
NODEVERIFY
  then
    NODE_OK=true
  fi
  NODE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_KIND=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(JSON.stringify(ir.kind))")
else
  NODE_OK=true
  NODE_KIND=null
fi
if [ -f /mnt/capture/nodejs-resource-ir.json ]; then
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if node <<'NODERESVERIFY'
const assert = require('assert/strict');
const fs = require('fs');
(async () => {
  const ir = JSON.parse(fs.readFileSync('/mnt/capture/nodejs-resource-ir.json', 'utf8'));
  const expectedRows = ir.rows.map((row) => ({ id: row.id, kind: row.kind, semanticState: row.semanticState }));
  const actualRows = await fetch('http://127.0.0.1:18183/resources').then((res) => res.json());
  assert.deepEqual(actualRows, expectedRows);
})().catch((error) => { console.error(error); process.exit(1); });
NODERESVERIFY
  then
    NODE_RESOURCE_OK=true
  fi
  NODE_RESOURCE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-resource-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_RESOURCE_KIND=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-resource-ir.json','utf8')); console.log(JSON.stringify(ir.kind))")
else
  NODE_RESOURCE_OK=true
  NODE_RESOURCE_KIND=null
fi
if [ "$FS_OK" = true ] && [ "$SQLITE_OK" = true ] && [ "$SERVICE_OK" = true ] && [ "$NODE_OK" = true ] && [ "$NODE_RESOURCE_OK" = true ]; then
  ACCEPTED=true
else
  ACCEPTED=false
fi
cat > /tmp/machinen-all3-target-verify.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-verifier",
  "accepted": $ACCEPTED,
  "filesystem": { "accepted": $FS_OK, "files": $(wc -l < /mnt/capture/filesystem-sha256.txt | tr -d ' ') },
  "sqlite": { "accepted": $SQLITE_OK, "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "service": { "accepted": $SERVICE_OK, "status": 200, "body": "$SERVICE_BODY" },
  "nodejsMemory": { "accepted": $NODE_OK, "memoryIrKind": $NODE_KIND, "materializedRows": $NODE_ROWS },
  "nodejsResource": { "accepted": $NODE_RESOURCE_OK, "resourceIrKind": $NODE_RESOURCE_KIND, "materializedRows": $NODE_RESOURCE_ROWS }
}
JSON
cat /tmp/machinen-all3-target-verify.json
[ "$ACCEPTED" = true ]
SH
  chmod +x "$dst/target-restore.sh" "$dst/target-verify.sh"
}

prepare_bundle "$ACCEPT_SOURCE"

REFUSAL_CASES=(
  "pending-promise:nodejs-memory-pending-promise.refuse:node-portability-memory-pending-promise-unsupported"
  "pending-microtask:nodejs-memory-pending-microtask.refuse:node-portability-memory-pending-microtask-unsupported"
  "active-socket:nodejs-memory-active-socket.refuse:node-portability-memory-active-socket-unsupported"
  "active-request:nodejs-memory-active-request.refuse:node-portability-memory-active-request-unsupported"
  "worker:nodejs-memory-worker.refuse:node-portability-memory-worker-unsupported"
  "native-addon:nodejs-memory-native-addon.refuse:node-portability-memory-native-addon-unsupported"
  "child-process:nodejs-memory-child-process.refuse:node-portability-memory-child-process-unsupported"
  "opaque-native-state:nodejs-memory-opaque-native-state.refuse:node-portability-memory-opaque-native-state-unsupported"
  "raw-v8-state:nodejs-memory-raw-v8-state.refuse:node-portability-memory-raw-v8-state-unsupported"
  "weakmap:nodejs-memory-weakmap.refuse:node-portability-memory-weakmap-unsupported"
  "timer:nodejs-memory-timer.refuse:node-portability-memory-timer-unsupported"
  "stream:nodejs-memory-stream.refuse:node-portability-memory-stream-unsupported"
  "resource-active-timer:nodejs-resource-active-timer.refuse:node-portability-resource-active-timer-unsupported"
  "resource-native-handle:nodejs-resource-native-handle.refuse:node-portability-resource-native-handle-unsupported"
  "resource-active-tls:nodejs-resource-active-tls.refuse:node-portability-resource-active-tls-unsupported"
  "resource-worker-live-state:nodejs-resource-worker-live-state.refuse:node-portability-resource-worker-live-state-unsupported"
)

run_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  "${SOURCE_CLI[@]}" boot --name "$SOURCE_NAME" --mount-live "$source_dir:/mnt/portable-vm-source:ro" --detach --json -- sleep 100000 \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  "${SOURCE_CLI[@]}" exec "$SOURCE_NAME" -- "mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  "${SOURCE_CLI[@]}" snapshot "$SOURCE_NAME" --portable --out "$snap_dir" --json \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  "${SOURCE_CLI[@]}" stop "$SOURCE_NAME" --force --json >"$WORK/${prefix}-source-stop.json" 2>"$WORK/${prefix}-source-stop.err" || true
}

run_snapshot "$ACCEPT_SOURCE" "$ACCEPT_SNAP" accept
"${TARGET_CLI[@]}" restore "$ACCEPT_SNAP" --name "$RESTORE_NAME" --json \
  >"$WORK/accept-restore.json" 2>"$WORK/accept-restore.err"
"${TARGET_CLI[@]}" stop "$RESTORE_NAME" --force --json >"$WORK/accept-target-stop.json" 2>"$WORK/accept-target-stop.err" || true

NO_PAUSE_SNAP="$WORK/node-memory-no-pause-boundary.snap"
cp -a "$ACCEPT_SNAP" "$NO_PAUSE_SNAP"
rm -f "$NO_PAUSE_SNAP/portable-vm-pause-boundary.json"
set +e
"${TARGET_CLI[@]}" restore "$NO_PAUSE_SNAP" --name "$RESTORE_NAME-no-pause" --json \
  >"$WORK/no-pause-boundary-restore.json" 2>"$WORK/no-pause-boundary-restore.err"
NO_PAUSE_STATUS=$?
set -e
if [ "$NO_PAUSE_STATUS" -eq 0 ]; then
  echo "expected missing pause boundary restore to fail" >&2
  exit 1
fi

for case_spec in "${REFUSAL_CASES[@]}"; do
  IFS=: read -r case_id marker expected_code <<EOF
$case_spec
EOF
  case_source="$WORK/source-bundle-node-memory-refusal-$case_id"
  case_snap="$WORK/node-memory-refusal-$case_id.snap"
  prepare_bundle "$case_source"
  touch "$case_source/$marker"
  run_snapshot "$case_source" "$case_snap" "refusal-$case_id"
  set +e
  "${TARGET_CLI[@]}" restore "$case_snap" --name "$RESTORE_NAME-refusal-$case_id" --json \
    >"$WORK/refusal-$case_id-restore.json" 2>"$WORK/refusal-$case_id-restore.err"
  REFUSAL_STATUS=$?
  set -e
  if [ "$REFUSAL_STATUS" -eq 0 ]; then
    echo "expected refusal restore to fail for $case_id" >&2
    exit 1
  fi
  "${TARGET_CLI[@]}" stop "$RESTORE_NAME-refusal-$case_id" --force --json >"$WORK/refusal-$case_id-target-stop.json" 2>"$WORK/refusal-$case_id-target-stop.err" || true
done

node - "$WORK" "$SOURCE_ARCH" "$TARGET_ARCH" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [work, sourceArch, targetArch] = process.argv.slice(2);
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(work, relative), 'utf8'));
const hash = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(work, relative))).digest('hex');
const acceptSnapshot = readJson('accept-snapshot.json');
const acceptRestore = readJson('accept-restore.json');
const acceptPlan = readJson('node-memory.snap/portable-vm-manifest-plan.json');
const acceptInventory = readJson('node-memory.snap/portable-vm-raw-inventory.json');
const nodeClassification = readJson('node-memory.snap/nodejs-memory-classification.json');
const nodeResourceClassification = readJson('node-memory.snap/nodejs-resource-classification.json');
const nodeResourceInventory = readJson('node-memory.snap/nodejs-resource-inventory.json');
const pauseBoundary = readJson('node-memory.snap/portable-vm-pause-boundary.json');
const nodeMemoryIr = readJson('node-memory.snap/nodejs-memory-ir.json');
const nodeResourceIr = readJson('node-memory.snap/nodejs-resource-ir.json');
const nodeMaterializer = fs.readFileSync(path.join(work, 'node-memory.snap/nodejs-memory-materializer.mjs'), 'utf8');
const nodeResourceMaterializer = fs.readFileSync(path.join(work, 'node-memory.snap/nodejs-resource-materializer.mjs'), 'utf8');
if (acceptSnapshot.accepted !== true || acceptSnapshot.sourceArchitecture !== sourceArch) throw new Error('accepted snapshot did not detect source architecture');
if (acceptSnapshot.pauseBoundary?.stoppedStateObserved !== true || acceptSnapshot.pauseBoundary?.pauseMechanism !== 'vmm-native-sigusr1-sigusr2') throw new Error('accepted snapshot did not prove VMM-native paused source VM boundary');
if (acceptSnapshot.pauseBoundary?.vmmNativeMarker?.vcpusStopped !== true) throw new Error('accepted snapshot missing VMM-native pause marker');
if (pauseBoundary.accepted !== true || pauseBoundary.sourceVmPauseRequired !== true || pauseBoundary.stoppedStateObserved !== true) throw new Error('pause boundary artifact did not prove stopped VM state');
if (pauseBoundary.pauseMechanism !== 'vmm-native-sigusr1-sigusr2' || pauseBoundary.vmmNativeMarker?.vcpusStopped !== true) throw new Error('pause boundary artifact did not retain VMM-native marker');
if (acceptPlan.captureBoundary?.stabilityPoint !== 'source-vm-paused' || acceptPlan.captureBoundary?.pauseBoundary !== 'portable-vm-pause-boundary.json') throw new Error('restore plan missing paused capture boundary');
if (acceptInventory.pauseBoundary?.stoppedStateObserved !== true) throw new Error('inventory missing paused source VM boundary');
const memoryRow = acceptPlan.restorePlan.rows.find((row) => row.id === 'nodejs-memory-ir');
if (!memoryRow || memoryRow.disposition !== 'product-supported') throw new Error('nodejs-memory-ir plan row missing');
if (memoryRow.restoreStrategy !== 'materialize-nodejs-memory-ir-target-native') throw new Error('nodejs memory restore strategy missing');
const resourceRow = acceptPlan.restorePlan.rows.find((row) => row.id === 'nodejs-resource-ir');
if (!resourceRow || resourceRow.disposition !== 'product-supported') throw new Error('nodejs-resource-ir plan row missing');
if (resourceRow.restoreStrategy !== 'materialize-nodejs-resource-ir-target-native') throw new Error('nodejs resource restore strategy missing');
if (!acceptInventory.items.some((item) => item.id === 'nodejs-memory-ir')) throw new Error('nodejs-memory-ir inventory item missing');
if (!acceptInventory.items.some((item) => item.id === 'nodejs-resource-inventory')) throw new Error('nodejs-resource-inventory item missing');
if (!acceptInventory.items.some((item) => item.id === 'nodejs-resource-ir')) throw new Error('nodejs-resource-ir inventory item missing');
if (!Array.isArray(nodeResourceInventory.checkedResourceClasses) || !nodeResourceInventory.checkedResourceClasses.includes('native-handles')) throw new Error('nodejs resource inventory did not classify native handles');
if (nodeClassification.restoreStrategy !== 'materialize-nodejs-memory-ir-target-native') throw new Error('node memory classification missing restore strategy');
if (nodeResourceClassification.restoreStrategy !== 'materialize-nodejs-resource-ir-target-native') throw new Error('node resource classification missing restore strategy');
const expectedMemoryRowIds = fs.readdirSync(path.join('portability', 'nodejs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
  .map((entry) => JSON.parse(fs.readFileSync(path.join('portability', 'nodejs', entry.name, 'portability.json'), 'utf8')))
  .filter((row) => row.disposition === 'product-supported' && row.slug.startsWith('memory-real-'))
  .map((row) => row.id)
  .sort((left, right) => left.localeCompare(right));
if (nodeMemoryIr.kind !== 'machinen.nodejs.memory-ir' || !Array.isArray(nodeMemoryIr.rows) || nodeMemoryIr.rows.length !== expectedMemoryRowIds.length) throw new Error('memory IR rows not retained');
if (JSON.stringify(nodeMemoryIr.rows.map((row) => row.id)) !== JSON.stringify(expectedMemoryRowIds)) throw new Error('memory IR row IDs drifted');
const rowEvidence = readJson('node-memory.snap/nodejs-memory-product-row-evidence.json');
if (!Array.isArray(rowEvidence) || rowEvidence.length !== expectedMemoryRowIds.length) throw new Error('memory row evidence was not retained');
for (const row of rowEvidence) {
  for (const stage of ['detect', 'capture', 'decode', 'classify', 'materialize', 'verify', 'retain']) {
    if (row.stages?.[stage] !== true) throw new Error(`${row.rowId} missing ${stage} stage evidence`);
  }
}
if (!nodeMaterializer.includes('machinen.nodejs.memory-ir') || !nodeMaterializer.includes('rawV8HeapRestoreUsed')) throw new Error('product-owned Node memory materializer was not injected');
if (!nodeResourceMaterializer.includes('machinen.nodejs.resource-ir') || !nodeResourceMaterializer.includes('rawNativeHandleRestoreUsed')) throw new Error('product-owned Node resource materializer was not injected');
const expectedResourceRowIds = [
  'nodejs-resource-timer-schedule',
  'nodejs-resource-reopenable-file',
  'nodejs-resource-http-listener-route',
  'nodejs-resource-drained-stream-buffer',
  'nodejs-resource-route-registry',
  'nodejs-resource-middleware-registry',
  'nodejs-resource-configured-outbound-client',
  'nodejs-resource-outbound-client-reconnect-policy',
  'nodejs-resource-idle-http-agent-config',
  'nodejs-resource-dns-resolver-config',
  'nodejs-resource-tcp-client-reconnect-config',
  'nodejs-resource-tls-client-reconnect-config',
  'nodejs-resource-udp-client-reconnect-config',
  'nodejs-resource-http2-client-session-config',
  'nodejs-resource-signal-handler-registry',
  'nodejs-resource-immediate-schedule',
  'nodejs-resource-unref-timer-schedule',
  'nodejs-resource-ttl-cache-expiration',
  'nodejs-resource-cache-expiration-timer',
  'nodejs-resource-timer-backed-refill',
  'nodejs-resource-timer-wheel-state',
  'nodejs-resource-delayed-queue-schedule',
  'nodejs-resource-monotonic-clock-baseline',
  'nodejs-resource-performance-timing-baseline',
  'nodejs-resource-active-refresh-schedule',
  'nodejs-resource-drained-readable-stream',
  'nodejs-resource-drained-writable-stream',
  'nodejs-resource-pipeline-drained-state',
  'nodejs-resource-reopenable-read-stream',
  'nodejs-resource-reopenable-write-stream',
  'nodejs-resource-reopenable-dir-handle',
  'nodejs-resource-fs-watcher-subscription',
  'nodejs-resource-transform-stream-drained-state',
  'nodejs-resource-backpressure-buffer-drained',
  'nodejs-resource-stream-backed-logger-sink',
  'nodejs-resource-log-transport-drained',
  'nodejs-resource-diagnostic-channel-subscription',
  'nodejs-resource-diagnostic-report-config',
  'nodejs-resource-profiler-session-disabled-config',
  'nodejs-resource-inspector-disabled-config',
  'nodejs-resource-distributed-rate-limit-config',
  'nodejs-resource-span-context-drained',
  'nodejs-resource-otel-exporter-config',
  'nodejs-resource-async-local-storage-snapshot',
  'nodejs-resource-async-hooks-registry',
  'nodejs-resource-proxy-descriptor',
  'nodejs-resource-esm-namespace-binding',
  'nodejs-resource-dynamic-import-settled-module',
  'nodejs-resource-module-loader-hook-registry',
  'nodejs-resource-object-keyed-map-descriptor',
  'nodejs-resource-map-iterator-position',
  'nodejs-resource-set-iterator-position',
  'nodejs-resource-error-stack-snapshot',
  'nodejs-resource-uncaught-exception-handler-registry',
  'nodejs-resource-private-field-descriptor',
  'nodejs-resource-bound-method-descriptor',
  'nodejs-resource-listener-closure-registry',
  'nodejs-resource-async-state-machine-snapshot',
  'nodejs-resource-mutable-config-snapshot',
  'nodejs-resource-serializer-replacer-registry',
  'nodejs-resource-regexp-match-iterator-position',
  'nodejs-resource-regexp-target-native-compile',
  'nodejs-resource-script-target-native-compile',
  'nodejs-resource-synthetic-module-declaration',
  'nodejs-resource-module-link-graph',
  'nodejs-resource-wasm-module-target-native-compile',
  'nodejs-resource-transfer-list-descriptor',
  'nodejs-resource-symbol-iterator-position',
  'nodejs-resource-numeric-overflow-policy',
  'nodejs-resource-temporal-object-descriptor',
  'nodejs-resource-vm-context-template',
  'nodejs-resource-vm-sandbox-global-descriptor',
  'nodejs-resource-wasm-instance-target-native',
  'nodejs-resource-wasm-memory-linear-bytes',
  'nodejs-resource-wasm-table-descriptor',
  'nodejs-resource-readline-interface-config',
  'nodejs-resource-tty-mode-config',
  'nodejs-resource-parser-token-checkpoint',
  'nodejs-resource-incremental-parser-checkpoint',
  'nodejs-resource-websocket-listener-registry',
  'nodejs-resource-worker-thread-restart',
  'nodejs-resource-native-addon-target-rebuild',
  'nodejs-resource-child-process-restart',
  'nodejs-resource-native-compiled-artifact-rebuild',
  'nodejs-resource-hash-public-input-digest',
  'nodejs-resource-deterministic-prng-seed',
  'nodejs-resource-buffer-pool-policy',
  'nodejs-resource-zero-fill-buffer-policy',
  'nodejs-resource-external-arraybuffer-declared-bytes',
  'nodejs-resource-weak-cache-drop-policy',
  'nodejs-resource-queue-consumer-retry-checkpoint',
  'nodejs-resource-pending-transition-checkpoint',
  'nodejs-resource-stdio-config',
  'nodejs-resource-transaction-retry-checkpoint',
  'nodejs-resource-cursor-query-descriptor',
  'nodejs-resource-oauth-device-flow-restart',
  'nodejs-resource-noncloneable-reconstruction-factory',
  'nodejs-resource-http-request-template',
  'nodejs-resource-http-response-template',
  'nodejs-resource-request-body-drained',
  'nodejs-resource-response-writer-drained',
  'nodejs-resource-request-scope-registry',
  'nodejs-resource-framework-plugin-registry',
  'nodejs-resource-scoped-provider-registry',
  'nodejs-resource-provider-factory-registry',
  'nodejs-resource-lifecycle-hook-registry',
  'nodejs-resource-render-context-template',
  'nodejs-resource-zlib-stream-drained-state',
  'nodejs-resource-brotli-stream-drained-state',
  'nodejs-resource-inflate-stream-drained-state',
  'nodejs-resource-deflate-stream-drained-state',
  'nodejs-resource-write-ahead-buffer-flushed',
];
if (nodeResourceIr.kind !== 'machinen.nodejs.resource-ir' || !Array.isArray(nodeResourceIr.rows) || nodeResourceIr.rows.length !== expectedResourceRowIds.length) throw new Error('resource IR rows not retained');
if (JSON.stringify(nodeResourceIr.rows.map((row) => row.id)) !== JSON.stringify(expectedResourceRowIds)) throw new Error('resource IR row IDs drifted');
if (nodeResourceIr.rows.some((row) => JSON.stringify(row).match(/rawFd|nativeHandle|uvHandle|rawV8Heap|pid/))) throw new Error('resource IR contains raw/native process state');
if (nodeResourceIr.rows.some((row) => row.captureBoundaryId !== 'portable-vm-pause-boundary.json' || row.pausedEvidence?.sourceVmPaused !== true)) throw new Error('resource IR row-level pause evidence missing');
if (acceptRestore.accepted !== true || acceptRestore.sourceArch !== sourceArch || acceptRestore.targetArch !== targetArch) throw new Error('accepted restore failed');
if (acceptRestore.portableVmPlan.nodejsMemoryRows !== 1) throw new Error('restore summary missing nodejsMemoryRows');
if (acceptRestore.portableVmPlan.nodejsResourceRows !== 1) throw new Error('restore summary missing nodejsResourceRows');
if (acceptRestore.workloads.nodejs.memoryRows !== 1 || acceptRestore.workloads.nodejs.memoryMaterializationRows !== 1) throw new Error('restore workload summary missing memory materialization row');
if (acceptRestore.workloads.nodejs.resourceRows !== 1 || acceptRestore.workloads.nodejs.resourceMaterializationRows !== 1) throw new Error('restore workload summary missing resource materialization row');
if (acceptRestore.workloads.nodejs.memoryVerified !== true || acceptRestore.workloads.nodejs.memoryMaterializedRows !== expectedMemoryRowIds.length) throw new Error('restore workload summary missing verified Node memory materialization');
if (acceptRestore.workloads.nodejs.resourceVerified !== true || acceptRestore.workloads.nodejs.resourceMaterializedRows !== expectedResourceRowIds.length) throw new Error('restore workload summary missing verified Node resource materialization');
if (acceptRestore.targetRestore.nodejsMemory?.materialized !== true || acceptRestore.targetRestore.nodejsMemory?.materializedRows !== expectedMemoryRowIds.length) throw new Error('target restore did not materialize Node memory IR');
if (acceptRestore.targetRestore.nodejsResource?.materialized !== true || acceptRestore.targetRestore.nodejsResource?.materializedRows !== expectedResourceRowIds.length) throw new Error('target restore did not materialize Node resource IR');
if (acceptRestore.targetVerify.nodejsMemory?.accepted !== true || acceptRestore.targetVerify.nodejsMemory?.memoryIrKind !== 'machinen.nodejs.memory-ir') throw new Error('target verifier did not verify Node memory IR app');
if (acceptRestore.targetVerify.nodejsResource?.accepted !== true || acceptRestore.targetVerify.nodejsResource?.resourceIrKind !== 'machinen.nodejs.resource-ir') throw new Error('target verifier did not verify Node resource IR app');
if (acceptRestore.claimGuard.arbitraryVmRestoreClaimed !== false || acceptRestore.claimGuard.rawVmStateReplayUsed !== false) throw new Error('portable VM claim guard drifted');
const refusalCases = [
  ['pending-promise', 'node-portability-memory-pending-promise-unsupported'],
  ['pending-microtask', 'node-portability-memory-pending-microtask-unsupported'],
  ['active-socket', 'node-portability-memory-active-socket-unsupported'],
  ['active-request', 'node-portability-memory-active-request-unsupported'],
  ['worker', 'node-portability-memory-worker-unsupported'],
  ['native-addon', 'node-portability-memory-native-addon-unsupported'],
  ['child-process', 'node-portability-memory-child-process-unsupported'],
  ['opaque-native-state', 'node-portability-memory-opaque-native-state-unsupported'],
  ['raw-v8-state', 'node-portability-memory-raw-v8-state-unsupported'],
  ['weakmap', 'node-portability-memory-weakmap-unsupported'],
  ['timer', 'node-portability-memory-timer-unsupported'],
  ['stream', 'node-portability-memory-stream-unsupported'],
  ['resource-active-timer', 'node-portability-resource-active-timer-unsupported'],
  ['resource-native-handle', 'node-portability-resource-native-handle-unsupported'],
  ['resource-active-tls', 'node-portability-resource-active-tls-unsupported'],
  ['resource-worker-live-state', 'node-portability-resource-worker-live-state-unsupported'],
];
const noPauseRestore = readJson('no-pause-boundary-restore.json');
if (noPauseRestore.accepted !== false || noPauseRestore.refusal?.code !== 'node-portability-resource-pause-boundary-missing') throw new Error('missing pause boundary restore did not fail closed');
const refusalResults = refusalCases.map(([caseId, expectedCode]) => {
  const snapshot = readJson(`refusal-${caseId}-snapshot.json`);
  const restore = readJson(`refusal-${caseId}-restore.json`);
  const plan = readJson(`node-memory-refusal-${caseId}.snap/portable-vm-manifest-plan.json`);
  if (snapshot.accepted !== true || snapshot.sourceArchitecture !== sourceArch) throw new Error(`${caseId} refusal snapshot failed`);
  const refusedRow = plan.restorePlan.rows.find((row) => row.refusalCode === expectedCode);
  if (!refusedRow || refusedRow.disposition !== 'refused') throw new Error(`${caseId} refusal row missing`);
  if (restore.accepted !== false || restore.refusal?.code !== expectedCode) throw new Error(`${caseId} restore did not fail closed`);
  const nodejs = restore.workloads?.nodejs;
  if (!Array.isArray(nodejs?.refusals) || !nodejs.refusals.some((row) => row.refusalCode === expectedCode)) throw new Error(`${caseId} restore summary missing grouped Node refusal`);
  if (expectedCode.startsWith('node-portability-memory-')) {
    if (!Array.isArray(nodejs?.memoryRefusals) || !nodejs.memoryRefusals.includes(expectedCode)) throw new Error(`${caseId} restore summary missing memoryRefusals entry`);
  } else {
    if (!Array.isArray(nodejs?.resourceRefusals) || !nodejs.resourceRefusals.includes(expectedCode)) throw new Error(`${caseId} restore summary missing resourceRefusals entry`);
  }
  return { caseId, restoreRefused: true, refusalCode: expectedCode, markerRefusedByPlan: true };
});
const artifacts = [
  'accept-snapshot.json',
  'accept-restore.json',
  'node-memory.snap/portable-vm-raw-inventory.json',
  'node-memory.snap/portable-vm-manifest-plan.json',
  'node-memory.snap/portable-vm-product-restore-summary.json',
  'node-memory.snap/portable-vm-pause-boundary.json',
  'node-memory.snap/nodejs-memory-ir.json',
  'node-memory.snap/nodejs-memory-classification.json',
  'node-memory.snap/nodejs-memory-materializer.mjs',
  'node-memory.snap/nodejs-memory-product-row-evidence.json',
  'node-memory.snap/nodejs-resource-ir.json',
  'node-memory.snap/nodejs-resource-inventory.json',
  'node-memory.snap/nodejs-resource-classification.json',
  'node-memory.snap/nodejs-resource-materializer.mjs',
  'no-pause-boundary-restore.json',
  'node-memory-no-pause-boundary.snap/portable-vm-manifest-plan.json',
  'node-memory-no-pause-boundary.snap/portable-vm-product-restore-summary.json',
  ...refusalCases.flatMap(([caseId]) => [
    `refusal-${caseId}-snapshot.json`,
    `refusal-${caseId}-restore.json`,
    `node-memory-refusal-${caseId}.snap/portable-vm-manifest-plan.json`,
    `node-memory-refusal-${caseId}.snap/portable-vm-product-restore-summary.json`,
  ]),
];
const report = {
  kind: 'machinen.portable-vm-product-node-memory-ir-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'portable-vm-product-node-memory-ir-v1',
  productCommandPath: 'machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json',
  sourceArchitectureDetected: true,
  targetArchitectureDetected: true,
  acceptedPath: {
    snapshotCompleted: true,
    restoreCompleted: true,
    sourceArch,
    targetArch,
    nodejsMemoryRows: acceptRestore.portableVmPlan.nodejsMemoryRows,
    nodejsResourceRows: acceptRestore.portableVmPlan.nodejsResourceRows,
    sourceVmPauseBoundary: pauseBoundary,
    memoryMaterializationRows: acceptRestore.workloads.nodejs.memoryMaterializationRows,
    resourceMaterializationRows: acceptRestore.workloads.nodejs.resourceMaterializationRows,
    memoryVerified: acceptRestore.workloads.nodejs.memoryVerified,
    resourceVerified: acceptRestore.workloads.nodejs.resourceVerified,
    materializedRows: acceptRestore.workloads.nodejs.memoryMaterializedRows,
    resourceMaterializedRows: acceptRestore.workloads.nodejs.resourceMaterializedRows,
    supportedSemanticRows: expectedMemoryRowIds,
    supportedResourceRows: expectedResourceRowIds,
    resourceInventory: nodeResourceInventory,
    resourceCaptureBoundary: nodeResourceIr.captureBoundary,
    rowEvidence,
    restoreStrategy: memoryRow.restoreStrategy,
    resourceRestoreStrategy: resourceRow.restoreStrategy,
    memoryIrKind: nodeMemoryIr.kind,
    resourceIrKind: nodeResourceIr.kind,
  },
  refusalPath: {
    snapshotCompleted: true,
    restoreRefused: true,
    refusalCode: 'node-portability-memory-pending-promise-unsupported',
  },
  pauseBoundaryRefusal: {
    restoreRefused: true,
    refusalCode: 'node-portability-resource-pause-boundary-missing',
  },
  refusalMatrix: refusalResults,
  claimGuard: {
    ...acceptRestore.claimGuard,
    arbitraryNodeProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    rawNativeHandleRestoreUsed: false,
    samePidContinuationClaimed: false,
  },
  notClaimed: [
    'arbitrary Node process restore',
    'raw V8 heap restore',
    'same PID continuation',
    'raw VM/vCPU/device replay',
    'arbitrary Linux process restore',
  ],
  artifacts: artifacts.map((relativePath) => ({ path: relativePath, sha256: hash(relativePath) })),
};
fs.writeFileSync(path.join(work, 'portable-vm-product-node-memory-ir-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

if [ -n "${WORK_DIR:-}" ]; then
  find "$WORK" -type f | while IFS= read -r file; do
    rel="${file#$WORK/}"
    case "$rel" in
      portable-vm-product-node-memory-ir-report.json|accept-snapshot.json|accept-restore.json|node-memory.snap/portable-vm-raw-inventory.json|node-memory.snap/portable-vm-manifest-plan.json|node-memory.snap/portable-vm-product-restore-summary.json|node-memory.snap/portable-vm-pause-boundary.json|node-memory.snap/nodejs-memory-ir.json|node-memory.snap/nodejs-memory-classification.json|node-memory.snap/nodejs-memory-materializer.mjs|node-memory.snap/nodejs-memory-product-row-evidence.json|node-memory.snap/nodejs-resource-ir.json|node-memory.snap/nodejs-resource-inventory.json|node-memory.snap/nodejs-resource-classification.json|node-memory.snap/nodejs-resource-materializer.mjs|no-pause-boundary-restore.json|node-memory-no-pause-boundary.snap/portable-vm-manifest-plan.json|node-memory-no-pause-boundary.snap/portable-vm-product-restore-summary.json|source-bundle-node-memory/target-restore.sh|source-bundle-node-memory/target-verify.sh|refusal-*-snapshot.json|refusal-*-restore.json|node-memory-refusal-*.snap/portable-vm-manifest-plan.json|node-memory-refusal-*.snap/portable-vm-product-restore-summary.json) ;;
      *) rm -f "$file" ;;
    esac
  done
  find "$WORK" -type d -empty -delete
fi

echo "portable VM product Node memory IR smoke passed: $WORK"
