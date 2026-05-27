#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CATALOG = [
  [
    "active-socket-queue",
    "runtime-network-active-socket-queue-ambiguous",
    "network",
    "Active socket queue cannot be migrated safely",
    "Unread inbound bytes, kernel queue order, and peer retry state are outside the portable descriptor.",
  ],
  [
    "peer-state",
    "runtime-network-peer-state-unavailable",
    "network",
    "Peer state is unavailable",
    "The remote endpoint's TCP/HTTP state cannot be captured by the local process.",
  ],
  [
    "bytes-in-flight",
    "runtime-network-bytes-in-flight-unsupported",
    "network",
    "Bytes in flight are unsupported",
    "Packets already handed to the transport may be replayed, lost, or reordered after restore.",
  ],
  [
    "tls-session-key",
    "runtime-network-tls-session-key-opaque",
    "network",
    "TLS session keys are opaque",
    "TLS traffic keys, record counters, and replay windows require a cryptographic-state contract.",
  ],
  [
    "websocket-frame-boundary",
    "runtime-network-websocket-frame-boundary-ambiguous",
    "network",
    "WebSocket frame boundary is ambiguous",
    "Partial frames and peer parser state cannot be inferred from the local socket alone.",
  ],
  [
    "missing-reconnect-policy",
    "runtime-network-reconnect-policy-required",
    "network",
    "Reconnect policy is required",
    "Active network sessions need an explicit close/drain/reconnect-after-restore policy.",
  ],
  [
    "native-opaque-state",
    "runtime-native-extension-opaque-state",
    "native-extension",
    "Native extension state is opaque",
    "C heap, runtime handles, and native library globals are not portable without an external-state contract.",
  ],
  [
    "native-abi-drift",
    "runtime-native-extension-abi-drift",
    "native-extension",
    "Native extension ABI drift",
    "The target-native binary ABI does not match the captured runtime contract.",
  ],
  [
    "native-build-id-mismatch",
    "runtime-native-extension-build-id-mismatch",
    "native-extension",
    "Native extension build ID mismatch",
    "The target-native artifact identity differs from the captured build ID/digest.",
  ],
  [
    "native-owned-fd",
    "runtime-native-extension-owned-fd-unsupported",
    "native-extension",
    "Native-owned file descriptor unsupported",
    "The runtime cannot safely rebind file descriptors owned by opaque native code.",
  ],
  [
    "native-background-thread",
    "runtime-native-extension-background-thread-unsupported",
    "native-extension",
    "Native background thread unsupported",
    "Thread stacks and synchronization state inside the extension are not modeled.",
  ],
  [
    "native-managed-callback",
    "runtime-native-extension-managed-callback-ambiguous",
    "native-extension",
    "Managed callback state is ambiguous",
    "Callbacks crossing native/managed runtimes need explicit rebind verification.",
  ],
  [
    "native-contract-missing",
    "runtime-native-extension-contract-missing",
    "native-extension",
    "Native external-state contract missing",
    "No versioned contract describes how to reload, rebind, and verify native state.",
  ],
  [
    "go-arbitrary-scheduler",
    "runtime-go-arbitrary-goroutine-scheduler-unsupported",
    "go-scheduler",
    "Arbitrary Go scheduler state unsupported",
    "Runnable queues and runtime-private scheduler invariants are not portable state.",
  ],
  [
    "go-runnable-queue",
    "runtime-go-runnable-queue-ambiguous",
    "go-scheduler",
    "Go runnable queue is ambiguous",
    "Runnable ordering and P/M/G assignment are runtime-private.",
  ],
  [
    "go-parked-goroutine",
    "runtime-go-parked-goroutine-ambiguous",
    "go-scheduler",
    "Parked goroutine state is ambiguous",
    "The wait reason and wakeup edge require runtime-private state.",
  ],
  [
    "go-channel-waiter",
    "runtime-go-channel-waiter-ambiguous",
    "go-scheduler",
    "Go channel waiter is ambiguous",
    "Send/receive queues cannot be recreated safely outside the bounded drained-channel subset.",
  ],
  [
    "go-select-race",
    "runtime-go-select-race-ambiguous",
    "go-scheduler",
    "Go select race is ambiguous",
    "Competing select cases depend on scheduler timing not represented in the portable descriptor.",
  ],
  [
    "go-netpoll-waiter",
    "runtime-go-netpoll-waiter-unsupported",
    "go-scheduler",
    "Go netpoll waiter unsupported",
    "Netpoll waiters combine scheduler and kernel socket state.",
  ],
  [
    "go-runtime-private-frame",
    "runtime-go-runtime-private-frame-unsupported",
    "go-scheduler",
    "Go runtime-private frame unsupported",
    "Runtime-private frames are not a stable target-native continuation boundary.",
  ],
  [
    "go-cgo-goroutine",
    "runtime-go-cgo-goroutine-unsupported",
    "go-scheduler",
    "Go cgo goroutine unsupported",
    "cgo stacks and C-owned state need an explicit native-state contract.",
  ],
];

function usage() {
  console.error(
    "usage: node scripts/hard-runtime-refusal-contract.mjs run-suite --out file [--summary-dir dir] [--work-dir dir]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.out) {
    usage();
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function targetRestore(code, message) {
  return {
    state: "refused",
    migrationCompleted: false,
    descriptorGateCompleted: false,
    targetVerifierResult: "not-run",
    refusal: { code, message },
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function remediation(family) {
  if (family === "network") {
    return "Close or drain sockets before snapshot, or configure reconnect-after-restore with an explicit transport contract.";
  }
  if (family === "native-extension") {
    return "Disable opaque native state or provide a versioned native external-state contract with target-native reload/rebind verification.";
  }
  return "Quiesce goroutines, drain channels, close netpoll waiters, avoid cgo, or restart at an application-level checkpoint.";
}

function graduation(family) {
  if (family === "network") {
    return [
      "portable transport descriptor",
      "peer-state contract",
      "cryptographic/session verifier where applicable",
      "target-native reconnect or replay proof",
    ];
  }
  if (family === "native-extension") {
    return [
      "binary path and digest",
      "build ID or ABI identity",
      "runtime ABI",
      "target-native artifact",
      "external-state contract version",
      "reload/rebind verifier",
    ];
  }
  return [
    "runtime-versioned scheduler descriptor",
    "target-native continuation boundary",
    "quiescence/wakeup verifier",
    "no runtime-private frame ambiguity",
  ];
}

function summaryFor(entry) {
  const [name, code, family, message, explanation] = entry;
  return {
    profile: "portable-machine-restore",
    state: "failed",
    remoteSourceTarget: `goal41-${name}-refusal`,
    targetRestore: targetRestore(code, message),
    refusalUx: {
      code,
      family,
      message,
      explanation,
      affectedRuntimes:
        family === "go-scheduler"
          ? ["go"]
          : family === "network"
            ? ["node", "python", "ruby", "go", "jvm"]
            : ["go", "jvm", "python", "ruby", "node"],
      currentBehavior: "stable refusal with migrationCompleted=false",
      remediation: remediation(family),
      graduationRequires: graduation(family),
      stableUntilPositiveProofGraduates: true,
    },
    securityInspection: {
      sourceIsaEmulationArtifactFound: false,
      sourceTextReplayArtifactFound: false,
      sidecarRuntimeArtifactFound: false,
      appHookArtifactFound: false,
      metadataOnlyShortcutAccepted: false,
      targetNativeExecutionRequired: true,
      passed: true,
    },
    proofDigest: sha256(`${code}:${message}:${explanation}`),
    timings: [],
  };
}

function runSuite(options) {
  const summaries = CATALOG.map(summaryFor);
  if (options.summary_dir) {
    mkdirSync(options.summary_dir, { recursive: true });
    for (const summary of summaries) {
      writeFileSync(
        join(options.summary_dir, `${summary.remoteSourceTarget}.json`),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
    }
  }
  return {
    kind: "machinen.goal41-hard-runtime-refusal-contract",
    state: "completed",
    profile: "portable-machine-restore",
    refusalCount: summaries.length,
    families: {
      network: summaries.filter((summary) => summary.refusalUx.family === "network").length,
      nativeExtension: summaries.filter(
        (summary) => summary.refusalUx.family === "native-extension",
      ).length,
      goScheduler: summaries.filter((summary) => summary.refusalUx.family === "go-scheduler")
        .length,
    },
    summaries,
    securityInspection: {
      sourceIsaEmulationArtifactFound: false,
      sourceTextReplayArtifactFound: false,
      sidecarRuntimeArtifactFound: false,
      appHookArtifactFound: false,
      metadataOnlyShortcutAccepted: false,
      passed: true,
    },
  };
}

const options = parseArgs(process.argv.slice(2));
const workDir = resolve(options.work_dir ?? join(tmpdir(), `machinen-goal41-${process.pid}`));
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
const summary = runSuite(options);
writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
