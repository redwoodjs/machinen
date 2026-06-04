#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-portable-vm-node-memory-xarch.XXXXXX")}" 
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
REMOTE_HOST="${MACHINEN_NODE_MEMORY_IR_AMD64_HOST:-root@192.168.0.8}"
REMOTE_REPO="${MACHINEN_NODE_MEMORY_IR_AMD64_REPO:-/mnt/shared-500G/machinen-product}"
REMOTE_WORK="${MACHINEN_NODE_MEMORY_IR_AMD64_WORK:-/mnt/shared-500G/tmp/machinen-node-memory-ir-cross-arch-$$}"
BASE_BUNDLE="${BASE_BUNDLE:-$ROOT/proofs/linux-vm-workload/real-cross-arch-portable-vm-all3-e2e/retained/bundle}"
LOCAL_CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" node packages/cli/dist/cli.js)
REMOTE_ENV="TMPDIR=/mnt/shared-500G/tmp XDG_CACHE_HOME=/mnt/shared-500G/cache MACHINEN_REGISTRY_DIR=/mnt/shared-500G/machinen-registry MACHINEN_ASSETS_DIR=${MACHINEN_REMOTE_ASSETS_DIR:-$REMOTE_REPO/release-assets}"

cleanup_local_vm() {
  local name="$1"
  local prefix="$2"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" stop "$name" --force --json >"$WORK/${prefix}-local-stop.json" 2>"$WORK/${prefix}-local-stop.err" || true
}
cleanup_remote_vm() {
  local name="$1"
  local prefix="$2"
  ssh "$REMOTE_HOST" "cd '$REMOTE_REPO'; $REMOTE_ENV MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js stop '$name' --force --json" >"$WORK/${prefix}-remote-stop.json" 2>"$WORK/${prefix}-remote-stop.err" || true
}
cleanup() {
  cleanup_local_vm "${ARM_SOURCE_NAME:-unused}" "cleanup-arm-source"
  cleanup_local_vm "${ARM_TARGET_NAME:-unused}" "cleanup-arm-target"
  cleanup_remote_vm "${AMD_SOURCE_NAME:-unused}" "cleanup-amd-source"
  cleanup_remote_vm "${AMD_TARGET_NAME:-unused}" "cleanup-amd-target"
  ssh "$REMOTE_HOST" "rm -rf '$REMOTE_WORK'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

prepare_bundle() {
  local dst="$1"
  local source_arch="$2"
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
  node - "$dst" "$source_arch" <<'NODE'
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
  return { rowId, reportPath, capture, irRow };
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
  cp proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained/source-bundle-node-memory/target-restore.sh "$dst/target-restore.sh"
  cp proofs/linux-vm-workload/portable-vm-product-node-memory-ir/retained/source-bundle-node-memory/target-verify.sh "$dst/target-verify.sh"
  chmod +x "$dst/target-restore.sh" "$dst/target-verify.sh"
}

run_local_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  local name="$4"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" boot --name "$name" --mount-live "$source_dir:/mnt/portable-vm-source:ro" --detach --json -- sleep 100000 \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" exec "$name" -- "mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" snapshot "$name" --portable --out "$snap_dir" --json \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  cleanup_local_vm "$name" "$prefix-source"
}

run_local_restore() {
  local snap_dir="$1"
  local prefix="$2"
  local name="$3"
  env MACHINEN_GUEST_ARCH=arm64 "${LOCAL_CLI[@]}" restore "$snap_dir" --name "$name" --json \
    >"$WORK/${prefix}-restore.json" 2>"$WORK/${prefix}-restore.err"
  cleanup_local_vm "$name" "$prefix-target"
}

remote() {
  ssh "$REMOTE_HOST" "cd '$REMOTE_REPO'; $REMOTE_ENV $*"
}

run_remote_snapshot() {
  local source_dir="$1"
  local snap_dir="$2"
  local prefix="$3"
  local name="$4"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js boot --name '$name' --mount-live '$source_dir:/mnt/portable-vm-source:ro' --detach --json -- sleep 100000" \
    >"$WORK/${prefix}-source-boot.json" 2>"$WORK/${prefix}-source-boot.err"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js exec '$name' -- 'mkdir -p /run/machinen/portable-vm && ln -sfn /mnt/portable-vm-source /run/machinen/portable-vm/source-bundle'" \
    >"$WORK/${prefix}-source-setup.out" 2>"$WORK/${prefix}-source-setup.err"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js snapshot '$name' --portable --out '$snap_dir' --json" \
    >"$WORK/${prefix}-snapshot.json" 2>"$WORK/${prefix}-snapshot.err"
  cleanup_remote_vm "$name" "$prefix-source"
}

run_remote_restore() {
  local snap_dir="$1"
  local prefix="$2"
  local name="$3"
  remote "MACHINEN_GUEST_ARCH=amd64 node packages/cli/dist/cli.js restore '$snap_dir' --name '$name' --json" \
    >"$WORK/${prefix}-restore.json" 2>"$WORK/${prefix}-restore.err"
  cleanup_remote_vm "$name" "$prefix-target"
}

/usr/bin/time -p pnpm build >"$WORK/local-build.stdout.txt" 2>"$WORK/local-build.stderr.txt"
rsync -az \
  --exclude .git \
  --exclude node_modules \
  --exclude .pnpm-store \
  --exclude .zig-cache \
  --exclude release-assets \
  --exclude 'proofs/linux-vm-workload/portable-vm-product-node-memory-ir-cross-arch/retained' \
  ./ "$REMOTE_HOST:$REMOTE_REPO/" \
  >"$WORK/remote-sync.stdout.txt" 2>"$WORK/remote-sync.stderr.txt"
ssh "$REMOTE_HOST" "cd '$REMOTE_REPO' && $REMOTE_ENV pnpm build && cp packages/microvm/zig-out/bin/machinen-vm packages/native-x64-linux/vmm/bin/machinen-vm" \
  >"$WORK/remote-build.stdout.txt" 2>"$WORK/remote-build.stderr.txt"
ssh "$REMOTE_HOST" "rm -rf '$REMOTE_WORK' && mkdir -p '$REMOTE_WORK'"

ARM_SOURCE_NAME="portable-vm-node-memory-arm-source-$(date +%s)-$$"
AMD_TARGET_NAME="portable-vm-node-memory-amd-target-$(date +%s)-$$"
AMD_SOURCE_NAME="portable-vm-node-memory-amd-source-$(date +%s)-$$"
ARM_TARGET_NAME="portable-vm-node-memory-arm-target-$(date +%s)-$$"

# arm64 snapshot -> amd64 restore
ARM_TO_AMD="$WORK/arm64-to-amd64"
mkdir -p "$ARM_TO_AMD"
prepare_bundle "$ARM_TO_AMD/source-bundle" "arm64"
run_local_snapshot "$ARM_TO_AMD/source-bundle" "$ARM_TO_AMD/node-memory.snap" "arm64-to-amd64" "$ARM_SOURCE_NAME"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_WORK/arm64-to-amd64/node-memory.snap'"
rsync -az --delete "$ARM_TO_AMD/node-memory.snap/" "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/"
run_remote_restore "$REMOTE_WORK/arm64-to-amd64/node-memory.snap" "arm64-to-amd64" "$AMD_TARGET_NAME"
rsync -az "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json" "$ARM_TO_AMD/remote-restore-summary.json"
cp "$ARM_TO_AMD/remote-restore-summary.json" "$ARM_TO_AMD/node-memory.snap/portable-vm-product-restore-summary.json"
rsync -az "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs" "$ARM_TO_AMD/nodejs-memory-materializer.mjs"
cp "$ARM_TO_AMD/nodejs-memory-materializer.mjs" "$ARM_TO_AMD/node-memory.snap/nodejs-memory-materializer.mjs"
rsync -az "$REMOTE_HOST:$REMOTE_WORK/arm64-to-amd64/node-memory.snap/nodejs-resource-materializer.mjs" "$ARM_TO_AMD/nodejs-resource-materializer.mjs"
cp "$ARM_TO_AMD/nodejs-resource-materializer.mjs" "$ARM_TO_AMD/node-memory.snap/nodejs-resource-materializer.mjs"

# amd64 snapshot -> arm64 restore
AMD_TO_ARM="$WORK/amd64-to-arm64"
mkdir -p "$AMD_TO_ARM"
prepare_bundle "$AMD_TO_ARM/source-bundle" "amd64"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_WORK/amd64-to-arm64/source-bundle' '$REMOTE_WORK/amd64-to-arm64/node-memory.snap'"
rsync -az --delete "$AMD_TO_ARM/source-bundle/" "$REMOTE_HOST:$REMOTE_WORK/amd64-to-arm64/source-bundle/"
run_remote_snapshot "$REMOTE_WORK/amd64-to-arm64/source-bundle" "$REMOTE_WORK/amd64-to-arm64/node-memory.snap" "amd64-to-arm64" "$AMD_SOURCE_NAME"
rsync -az --delete "$REMOTE_HOST:$REMOTE_WORK/amd64-to-arm64/node-memory.snap/" "$AMD_TO_ARM/node-memory.snap/"
run_local_restore "$AMD_TO_ARM/node-memory.snap" "amd64-to-arm64" "$ARM_TARGET_NAME"

node - "$WORK" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const work = process.argv[2];
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(work, relative), 'utf8'));
const sha256 = (relative) => crypto.createHash('sha256').update(fs.readFileSync(path.join(work, relative))).digest('hex');
const directions = [
  { id: 'arm64-to-amd64', sourceArch: 'arm64', targetArch: 'amd64', restorePath: 'arm64-to-amd64-restore.json', snapDir: 'arm64-to-amd64/node-memory.snap' },
  { id: 'amd64-to-arm64', sourceArch: 'amd64', targetArch: 'arm64', restorePath: 'amd64-to-arm64-restore.json', snapDir: 'amd64-to-arm64/node-memory.snap' },
];
const expectedMemoryRowIds = fs.readdirSync(path.join('portability', 'nodejs'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
  .map((entry) => JSON.parse(fs.readFileSync(path.join('portability', 'nodejs', entry.name, 'portability.json'), 'utf8')))
  .filter((row) => row.disposition === 'product-supported' && row.slug.startsWith('memory-real-'))
  .map((row) => row.id)
  .sort((left, right) => left.localeCompare(right));
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
const results = directions.map((direction) => {
  const restore = readJson(direction.restorePath);
  const plan = readJson(path.join(direction.snapDir, 'portable-vm-manifest-plan.json'));
  const pauseBoundary = readJson(path.join(direction.snapDir, 'portable-vm-pause-boundary.json'));
  const materializerPath = path.join(direction.snapDir, 'nodejs-memory-materializer.mjs');
  const resourceMaterializerPath = path.join(direction.snapDir, 'nodejs-resource-materializer.mjs');
  const materializer = fs.readFileSync(path.join(work, materializerPath), 'utf8');
  const resourceMaterializer = fs.readFileSync(path.join(work, resourceMaterializerPath), 'utf8');
  if (restore.accepted !== true) throw new Error(`${direction.id} restore not accepted`);
  if (restore.sourceArch !== direction.sourceArch || restore.targetArch !== direction.targetArch) throw new Error(`${direction.id} arch mismatch`);
  if (pauseBoundary.accepted !== true || pauseBoundary.sourceVmPauseRequired !== true || pauseBoundary.stoppedStateObserved !== true) throw new Error(`${direction.id} did not prove paused source VM boundary`);
  if (pauseBoundary.pauseMechanism !== 'vmm-native-sigusr1-sigusr2' || pauseBoundary.vmmNativeMarker?.vcpusStopped !== true) throw new Error(`${direction.id} did not retain VMM-native pause marker`);
  if (plan.captureBoundary?.stabilityPoint !== 'source-vm-paused' || plan.captureBoundary?.pauseBoundary !== 'portable-vm-pause-boundary.json') throw new Error(`${direction.id} plan missing paused source VM boundary`);
  if (restore.workloads?.nodejs?.memoryVerified !== true) throw new Error(`${direction.id} did not verify Node memory`);
  if (restore.workloads?.nodejs?.resourceVerified !== true) throw new Error(`${direction.id} did not verify Node resource IR`);
  if (restore.workloads?.nodejs?.memoryMaterializedRows !== expectedMemoryRowIds.length) throw new Error(`${direction.id} materialized row count mismatch`);
  if (restore.workloads?.nodejs?.resourceMaterializedRows !== expectedResourceRowIds.length) throw new Error(`${direction.id} resource materialized row count mismatch`);
  if (!materializer.includes('machinen.nodejs.memory-ir') || !materializer.includes('rawV8HeapRestoreUsed')) throw new Error(`${direction.id} materializer missing product guards`);
  if (!resourceMaterializer.includes('machinen.nodejs.resource-ir') || !resourceMaterializer.includes('rawNativeHandleRestoreUsed')) throw new Error(`${direction.id} resource materializer missing product guards`);
  if (!plan.restorePlan.rows.some((row) => row.id === 'nodejs-memory-ir' && row.restoreStrategy === 'materialize-nodejs-memory-ir-target-native')) throw new Error(`${direction.id} plan missing memory IR row`);
  if (!plan.restorePlan.rows.some((row) => row.id === 'nodejs-resource-ir' && row.restoreStrategy === 'materialize-nodejs-resource-ir-target-native')) throw new Error(`${direction.id} plan missing resource IR row`);
  const memoryIr = readJson(path.join(direction.snapDir, 'nodejs-memory-ir.json'));
  const resourceIr = readJson(path.join(direction.snapDir, 'nodejs-resource-ir.json'));
  const resourceInventory = readJson(path.join(direction.snapDir, 'nodejs-resource-inventory.json'));
  const rowEvidence = readJson(path.join(direction.snapDir, 'nodejs-memory-product-row-evidence.json'));
  if (JSON.stringify(memoryIr.rows?.map((row) => row.id)) !== JSON.stringify(expectedMemoryRowIds)) throw new Error(`${direction.id} memory IR row IDs drifted`);
  if (JSON.stringify(resourceIr.rows?.map((row) => row.id)) !== JSON.stringify(expectedResourceRowIds)) throw new Error(`${direction.id} resource IR row IDs drifted`);
  if (resourceIr.rows.some((row) => JSON.stringify(row).match(/rawFd|nativeHandle|uvHandle|rawV8Heap|pid/))) throw new Error(`${direction.id} resource IR contains raw/native process state`);
  if (resourceIr.rows.some((row) => row.captureBoundaryId !== 'portable-vm-pause-boundary.json' || row.pausedEvidence?.sourceVmPaused !== true)) throw new Error(`${direction.id} resource IR row-level pause evidence missing`);
  if (!Array.isArray(resourceInventory.checkedResourceClasses) || !resourceInventory.checkedResourceClasses.includes('native-handles')) throw new Error(`${direction.id} resource inventory did not classify native handles`);
  if (!Array.isArray(rowEvidence) || rowEvidence.length !== expectedMemoryRowIds.length) throw new Error(`${direction.id} row evidence missing`);
  for (const row of rowEvidence) {
    for (const stage of ['detect', 'capture', 'decode', 'classify', 'materialize', 'verify', 'retain']) {
      if (row.stages?.[stage] !== true) throw new Error(`${direction.id} ${row.rowId} missing ${stage} evidence`);
    }
  }
  return {
    id: direction.id,
    accepted: true,
    sourceArch: direction.sourceArch,
    targetArch: direction.targetArch,
    nodejsMemoryRows: restore.portableVmPlan.nodejsMemoryRows,
    nodejsResourceRows: restore.portableVmPlan.nodejsResourceRows,
    sourceVmPauseBoundary: pauseBoundary,
    memoryVerified: restore.workloads.nodejs.memoryVerified,
    resourceVerified: restore.workloads.nodejs.resourceVerified,
    memoryMaterializedRows: restore.workloads.nodejs.memoryMaterializedRows,
    resourceMaterializedRows: restore.workloads.nodejs.resourceMaterializedRows,
    supportedSemanticRows: expectedMemoryRowIds,
    supportedResourceRows: expectedResourceRowIds,
    resourceInventory,
    resourceCaptureBoundary: resourceIr.captureBoundary,
    rowEvidence,
    memoryIrKind: restore.targetVerify.nodejsMemory.memoryIrKind,
    resourceIrKind: restore.targetVerify.nodejsResource.resourceIrKind,
    productMaterializerInjected: true,
    productResourceMaterializerInjected: true,
  };
});
const artifacts = [
  'arm64-to-amd64-snapshot.json',
  'arm64-to-amd64-restore.json',
  'arm64-to-amd64/node-memory.snap/portable-vm-manifest-plan.json',
  'arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json',
  'arm64-to-amd64/node-memory.snap/portable-vm-pause-boundary.json',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-ir.json',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs',
  'arm64-to-amd64/node-memory.snap/nodejs-memory-product-row-evidence.json',
  'arm64-to-amd64/node-memory.snap/nodejs-resource-ir.json',
  'arm64-to-amd64/node-memory.snap/nodejs-resource-inventory.json',
  'arm64-to-amd64/node-memory.snap/nodejs-resource-materializer.mjs',
  'amd64-to-arm64-snapshot.json',
  'amd64-to-arm64-restore.json',
  'amd64-to-arm64/node-memory.snap/portable-vm-manifest-plan.json',
  'amd64-to-arm64/node-memory.snap/portable-vm-product-restore-summary.json',
  'amd64-to-arm64/node-memory.snap/portable-vm-pause-boundary.json',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-ir.json',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-materializer.mjs',
  'amd64-to-arm64/node-memory.snap/nodejs-memory-product-row-evidence.json',
  'amd64-to-arm64/node-memory.snap/nodejs-resource-ir.json',
  'amd64-to-arm64/node-memory.snap/nodejs-resource-inventory.json',
  'amd64-to-arm64/node-memory.snap/nodejs-resource-materializer.mjs',
];
const report = {
  kind: 'machinen.portable-vm-product-node-memory-ir-cross-arch-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'portable-vm-product-node-memory-ir-cross-arch-v1',
  productCommandPath: 'machinen snapshot <vm> --portable --out <bundle>; machinen restore <bundle> --json',
  directions: results,
  claimGuard: {
    arbitraryVmRestoreClaimed: false,
    rawVmStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
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
  artifacts: artifacts.map((relativePath) => ({ path: relativePath, sha256: sha256(relativePath) })),
};
fs.writeFileSync(path.join(work, 'portable-vm-product-node-memory-ir-cross-arch-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

if [ -n "${WORK_DIR:-}" ]; then
  find "$WORK" -type f | while IFS= read -r file; do
    rel="${file#$WORK/}"
    case "$rel" in
      portable-vm-product-node-memory-ir-cross-arch-report.json|arm64-to-amd64-snapshot.json|arm64-to-amd64-restore.json|arm64-to-amd64/node-memory.snap/portable-vm-manifest-plan.json|arm64-to-amd64/node-memory.snap/portable-vm-product-restore-summary.json|arm64-to-amd64/node-memory.snap/portable-vm-pause-boundary.json|arm64-to-amd64/node-memory.snap/nodejs-memory-ir.json|arm64-to-amd64/node-memory.snap/nodejs-memory-materializer.mjs|arm64-to-amd64/node-memory.snap/nodejs-memory-product-row-evidence.json|arm64-to-amd64/node-memory.snap/nodejs-resource-ir.json|arm64-to-amd64/node-memory.snap/nodejs-resource-inventory.json|arm64-to-amd64/node-memory.snap/nodejs-resource-materializer.mjs|amd64-to-arm64-snapshot.json|amd64-to-arm64-restore.json|amd64-to-arm64/node-memory.snap/portable-vm-manifest-plan.json|amd64-to-arm64/node-memory.snap/portable-vm-product-restore-summary.json|amd64-to-arm64/node-memory.snap/portable-vm-pause-boundary.json|amd64-to-arm64/node-memory.snap/nodejs-memory-ir.json|amd64-to-arm64/node-memory.snap/nodejs-memory-materializer.mjs|amd64-to-arm64/node-memory.snap/nodejs-memory-product-row-evidence.json|amd64-to-arm64/node-memory.snap/nodejs-resource-ir.json|amd64-to-arm64/node-memory.snap/nodejs-resource-inventory.json|amd64-to-arm64/node-memory.snap/nodejs-resource-materializer.mjs) ;;
      *) rm -f "$file" ;;
    esac
  done
  find "$WORK" -type d -empty -delete
fi

echo "portable VM product Node memory IR cross-arch smoke passed: $WORK"
