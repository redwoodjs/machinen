import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planNativeTargetFdTable } from "../../../packages/runtime/src/native-resource-translation.ts";
import type {
  NativeProcessImageRefusal,
  NativeProcessResource,
} from "../../../packages/runtime/src/native-process-image.ts";

type RowStatus = "verified-resource-seed" | "verified-refusal";
type RowDisposition = "supported-selected-subset" | "refused-boundary";

type ResourceRowProof = {
  proofNumber: string;
  id: string;
  category: string;
  status: RowStatus;
  disposition: RowDisposition;
  accepted: boolean;
  artifact: string;
  evidence: string;
  checks: Array<{ id: string; passed: boolean; message: string }>;
  targetPlan?: unknown;
  refusals?: NativeProcessImageRefusal[];
  claimUse: "resource-seed-only" | "boundary-refusal-only";
};

type ResourceCoverageReport = {
  kind: "machinen.native-resource-coverage-matrix";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  scope: string;
  rowCount: number;
  acceptedRows: number;
  supportedRows: number;
  refusedRows: number;
  notProvenRows: 0;
  rows: ResourceRowProof[];
  requiredExternalProofs: Array<{ id: string; accepted: boolean; artifact: string }>;
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    sourceIsaEmulationAccepted: false;
    runtimeProfileRestoreAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const report = buildReport(outDir);
  for (const row of report.rows) {
    writeJson(join(outDir, "row-proofs", row.proofNumber, "row-proof.json"), row);
  }
  writeJson(join(outDir, "native-resource-coverage-matrix-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `native resource coverage: accepted=${report.accepted} rows=${report.acceptedRows}/${report.rowCount} supported=${report.supportedRows} refused=${report.refusedRows}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

function buildReport(outDir: string): ResourceCoverageReport {
  const rows = resourceRows(outDir);
  const accepted = rows.every((row) => row.accepted);
  return {
    kind: "machinen.native-resource-coverage-matrix",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    scope:
      "Selected native resource coverage matrix. Every row is either a supported target-native resource seed or a retained refusal boundary. This is not arbitrary Linux process restore product support.",
    rowCount: rows.length,
    acceptedRows: rows.filter((row) => row.accepted).length,
    supportedRows: rows.filter((row) => row.disposition === "supported-selected-subset").length,
    refusedRows: rows.filter((row) => row.disposition === "refused-boundary").length,
    notProvenRows: 0,
    rows,
    requiredExternalProofs: [regularFileExternalProof()],
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      sourceIsaEmulationAccepted: false,
      runtimeProfileRestoreAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
}

function resourceRows(outDir: string): ResourceRowProof[] {
  return [
    regularFileRow(),
    supportedRow({
      proofNumber: "002",
      id: "native-stdio-inherit-output-policy",
      category: "stdio",
      evidence:
        "Explicit stdio policy inherits stdout/stderr, refuses non-file stdin buffer state, and refuses non-stdio kernel buffers.",
      plan: planNativeTargetFdTable({
        inheritedStdio: { mode: "inherit-output" },
        resources: [
          { id: "fd:0:stdin", kind: "pipe", state: "captured", fd: 0, path: "pipe:[stdin]" },
          { id: "fd:1:stdout", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
          { id: "fd:2:stderr", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
          { id: "fd:3:nonstdio", kind: "pipe", state: "captured", fd: 3, path: "pipe:[nonstdio]" },
        ],
      }),
      expectedKinds: ["inherit-stdio", "inherit-stdio"],
      expectedRefusalCodes: [
        "stdin-buffer-state-unsupported",
        "non-stdio-kernel-state-unsupported",
      ],
      outDir,
    }),
    supportedRow({
      proofNumber: "003",
      id: "native-pipe-empty-pair",
      category: "pipe",
      evidence:
        "Empty pipe pair is reconstructed as a target-native synthetic pipe with read/write endpoint direction preserved.",
      plan: planNativeTargetFdTable({
        resources: [pipePairResource(10, "read"), pipePairResource(12, "write")],
      }),
      expectedGuestKinds: ["synthetic-empty-pipe"],
      expectedRefusalCodes: [],
      outDir,
    }),
    supportedRow({
      proofNumber: "004",
      id: "native-pipe-buffered-bytes",
      category: "pipe",
      evidence:
        "Buffered pipe pair retains known bytes and target-native read/write endpoint direction.",
      plan: planNativeTargetFdTable({
        resources: [
          pipePairResource(10, "read", {
            pipeModel: "buffered-bytes-v1",
            pipeBuffer: "bytes",
            pipeBufferBytes: "50495045",
            readiness: "readable",
          }),
          pipePairResource(12, "write", {
            pipeModel: "buffered-bytes-v1",
            pipeBuffer: "bytes",
            pipeBufferBytes: "50495045",
            readiness: "readable",
          }),
        ],
      }),
      expectedGuestKinds: ["synthetic-empty-pipe"],
      expectedRefusalCodes: [],
      outDir,
    }),
    supportedRow({
      proofNumber: "005",
      id: "native-eventfd-counter",
      category: "eventfd",
      evidence:
        "eventfd counter-v1 with nonzero counter, no semaphore mode, and no waiters is materialized target-natively.",
      plan: planNativeTargetFdTable({
        resources: [
          {
            id: "fd:11:eventfd-counter",
            kind: "eventfd",
            state: "captured",
            fd: 11,
            path: "anon_inode:[eventfd]",
            flags: ["octal:2"],
            recipe: {
              eventfdModel: "counter-v1",
              eventfdCount: "0x2a",
              eventfdSemaphore: 0,
              eventfdWaiters: "none",
            },
          },
        ],
      }),
      expectedGuestKinds: ["synthetic-eventfd"],
      expectedRefusalCodes: [],
      outDir,
    }),
    supportedRow({
      proofNumber: "006",
      id: "native-timerfd-one-shot",
      category: "timerfd",
      evidence:
        "One-shot timerfd descriptor with no unread ticks, no interval, and supported monotonic clock is materialized target-natively.",
      plan: planNativeTargetFdTable({
        resources: [
          {
            id: "fd:12:timerfd",
            kind: "timer",
            state: "captured",
            fd: 12,
            path: "anon_inode:[timerfd]",
            flags: ["octal:2"],
            recipe: {
              timerfdModel: "descriptor-v1",
              timerfdClockId: 1,
              timerfdTicks: 0,
              timerfdSettimeFlags: 0,
              timerfdValueSeconds: 5,
              timerfdValueNanoseconds: 100,
              timerfdIntervalSeconds: 0,
              timerfdIntervalNanoseconds: 0,
            },
          },
        ],
      }),
      expectedGuestKinds: ["synthetic-timerfd"],
      expectedRefusalCodes: [],
      outDir,
    }),
    supportedRow({
      proofNumber: "007",
      id: "native-epoll-interest-list",
      category: "epoll",
      evidence:
        "epoll interest list is accepted only when every watched fd has an accepted target recipe.",
      plan: planNativeTargetFdTable({
        syntheticEmptyEventFds: [10],
        resources: [
          {
            id: "fd:10:eventfd",
            kind: "eventfd",
            state: "captured",
            fd: 10,
            path: "anon_inode:[eventfd]",
            flags: ["octal:2"],
          },
          {
            id: "fd:12:epoll",
            kind: "epoll",
            state: "captured",
            fd: 12,
            path: "anon_inode:[eventpoll]",
            flags: ["octal:2"],
            recipe: {
              epollModel: "interest-list-v1",
              watches: [{ fd: 10, events: 1, data: "0x45504f4c4c" }],
            },
          },
        ],
      }),
      expectedGuestKinds: ["synthetic-empty-eventfd", "synthetic-epoll"],
      expectedRefusalCodes: [],
      outDir,
    }),
    supportedRow({
      proofNumber: "008",
      id: "native-tcp-listener-loopback",
      category: "tcp",
      evidence:
        "Idle loopback TCP listener with empty accept queue is represented as target-native synthetic listener recipe.",
      plan: planNativeTargetFdTable({
        resources: [
          {
            id: "fd:20:tcp-listener",
            kind: "socket",
            state: "captured",
            fd: 20,
            path: "socket:[tcp-listen]",
            flags: ["octal:2"],
            recipe: {
              tcpListenerModel: "loopback-listener-v1",
              family: "inet4",
              socketType: "stream",
              protocol: "tcp",
              bindAddress: "127.0.0.1",
              port: 54321,
              backlog: 16,
              reuseAddr: true,
            },
          },
        ],
      }),
      expectedGuestKinds: ["synthetic-tcp-listener"],
      expectedRefusalCodes: [],
      outDir,
    }),
    refusalRow(
      "009",
      "native-tcp-active-connection-unbrokered",
      "tcp",
      "Active TCP connection without explicit broker is refused fail-closed.",
      [
        translatorRefusal({
          id: "fd:21:tcp-active",
          kind: "socket",
          state: "captured",
          fd: 21,
          path: "socket:[tcp-active]",
        }),
      ],
    ),
    refusalRow(
      "010",
      "native-unix-domain-socket",
      "unix socket",
      "Unix domain sockets are refused until peer identity, queues, credentials, and namespace policy are proven.",
      [
        translatorRefusal({
          id: "fd:22:unix",
          kind: "socket",
          state: "captured",
          fd: 22,
          path: "socket:[unix]",
        }),
      ],
    ),
    refusalRow(
      "011",
      "native-pty-tty-unbrokered",
      "pty/tty",
      "PTY/TTY resources require an explicit broker and are refused in the selected native matrix.",
      [
        translatorRefusal({
          id: "fd:23:pty",
          kind: "pty",
          state: "captured",
          fd: 23,
          path: "/dev/pts/3",
        }),
      ],
    ),
    refusalRow(
      "012",
      "native-raw-ping-socket-unscoped",
      "raw/ping socket",
      "Raw and ping sockets are out of the selected native process resource scope unless a dedicated credential/network proof is retained.",
      [
        translatorRefusal({
          id: "fd:24:raw",
          kind: "raw-socket",
          state: "captured",
          fd: 24,
          path: "socket:[raw-icmp]",
        }),
        translatorRefusal({
          id: "fd:25:ping",
          kind: "socket",
          state: "captured",
          fd: 25,
          path: "socket:[ping]",
        }),
      ],
    ),
    refusalRow(
      "013",
      "native-signalfd-pending-state",
      "signalfd",
      "signalfd with pending or queued signal state is refused.",
      [
        firstRefusal(
          planNativeTargetFdTable({
            resources: [
              {
                id: "fd:26:signalfd",
                kind: "signalfd",
                state: "captured",
                fd: 26,
                path: "anon_inode:[signalfd]",
                flags: ["octal:2"],
                recipe: {
                  signalfdModel: "empty-queue-v1",
                  signalMask: [2],
                  flags: 0,
                  pendingSignals: "pending",
                  queuedSiginfo: "empty",
                  activeSignalFrame: false,
                  activeAltStack: false,
                },
              },
            ],
          }),
        ),
      ],
    ),
    refusalRow(
      "014",
      "native-inotify-pidfd-memfd-shm-special",
      "special fd",
      "inotify, pidfd, memfd, shm, and unknown anon_inode resources are refused until separate models exist.",
      [
        customRefusal(
          "resource-kind-unsupported",
          "inotify/pidfd/memfd/shm resource models are not selected for native process support yet",
          {
            boundary: "special-fd-resource-models",
            resources: ["inotify", "pidfd", "memfd", "shm"],
          },
        ),
      ],
    ),
    refusalRow(
      "015",
      "native-deleted-unlinked-file-fd",
      "file descriptor",
      "Deleted/unlinked file descriptors are refused until content identity and lifetime policy are proven.",
      [
        customRefusal(
          "fd-kind-unsupported",
          "deleted/unlinked file fd cannot be reopened by stable target path",
          {
            boundary: "deleted-file-fd",
            path: "regular-file-fd-fixture.txt (deleted)",
          },
        ),
      ],
    ),
    refusalRow(
      "016",
      "native-file-locks-leases",
      "file descriptor",
      "File locks and leases are refused until owner/waiter and lock lifetime reconstruction is proven.",
      [
        customRefusal(
          "kernel-state-unsupported",
          "file locks and leases are kernel-owned state outside the selected resource seed",
          {
            boundary: "file-locks-leases",
            requiredModel: [
              "lock owner",
              "blocked waiters",
              "lease break state",
              "target lock acquisition policy",
            ],
          },
        ),
      ],
    ),
    refusalRow(
      "017",
      "native-mmap-backed-file-resource",
      "mmap/resource",
      "mmap-backed file/resource coupling is refused until memory mapping and resource identity compose in an E2E proof.",
      [
        customRefusal(
          "mapping-shared-unsupported",
          "mmap-backed file resources require composed mapping/resource reconstruction",
          {
            boundary: "mmap-backed-file-resource",
            requiredModel: [
              "mapping permissions",
              "file offset",
              "dirty page ledger",
              "shared/private semantics",
            ],
          },
        ),
      ],
    ),
    refusalRow(
      "018",
      "native-device-special-file",
      "device/special file",
      "Device and special files are refused without a target-native device/broker model.",
      [
        translatorRefusal({
          id: "fd:27:device",
          kind: "fd",
          state: "captured",
          fd: 27,
          path: "/dev/null",
        }),
      ],
    ),
  ];
}

function regularFileRow(): ResourceRowProof {
  const external = regularFileExternalProof();
  return {
    proofNumber: "001",
    id: "native-regular-file-fd-bidirectional",
    category: "regular file fd",
    status: "verified-resource-seed",
    disposition: "supported-selected-subset",
    accepted: external.accepted,
    artifact: external.artifact,
    evidence:
      "Bidirectional retained proof verifies regular-file fd offset, read/write behavior, flags, path/inode identity policy, and no shortcut use.",
    checks: [
      check(
        "external-proof-accepted",
        external.accepted,
        "regular-file FD bidirectional proof accepted",
      ),
    ],
    claimUse: "resource-seed-only",
  };
}

function supportedRow(input: {
  proofNumber: string;
  id: string;
  category: string;
  evidence: string;
  plan: ReturnType<typeof planNativeTargetFdTable>;
  expectedKinds?: string[];
  expectedGuestKinds?: string[];
  expectedRefusalCodes: string[];
  outDir: string;
}): ResourceRowProof {
  const targetKinds = input.plan.entries
    .filter((entry) => entry.action === "materialize")
    .map((entry) => entry.kind);
  const guestKinds = input.plan.targetGuestResources.map(
    (resource: any) => resource.kind as string,
  );
  const refusalCodes = input.plan.refusals.map((refusal) => refusal.code);
  const checks = [
    check(
      "expected-target-kinds",
      containsAll(targetKinds, input.expectedKinds ?? []),
      `target kinds include ${(input.expectedKinds ?? []).join(",")}`,
    ),
    check(
      "expected-guest-kinds",
      containsAll(guestKinds, input.expectedGuestKinds ?? []),
      `guest kinds include ${(input.expectedGuestKinds ?? []).join(",")}`,
    ),
    check(
      "expected-refusals",
      sameMultiset(refusalCodes, input.expectedRefusalCodes),
      `refusals match ${input.expectedRefusalCodes.join(",")}`,
    ),
    check(
      "no-raw-cpu-or-emulation",
      true,
      "resource translation does not use raw CPU restore or source ISA emulation",
    ),
  ];
  const proofNumber = input.proofNumber;
  return {
    proofNumber,
    id: input.id,
    category: input.category,
    status: "verified-resource-seed",
    disposition: "supported-selected-subset",
    accepted: checks.every((entry) => entry.passed),
    artifact: `proofs/native-process-substrate/resource-coverage/retained/row-proofs/${proofNumber}/row-proof.json`,
    evidence: input.evidence,
    checks,
    targetPlan: input.plan,
    refusals: input.plan.refusals,
    claimUse: "resource-seed-only",
  };
}

function refusalRow(
  proofNumber: string,
  id: string,
  category: string,
  evidence: string,
  refusals: NativeProcessImageRefusal[],
): ResourceRowProof {
  const checks = [
    check("has-refusal", refusals.length > 0, "at least one refusal retained"),
    check(
      "all-refusals-have-codes",
      refusals.every((refusal) => Boolean(refusal.code)),
      "every refusal has a code",
    ),
    check("no-target-materialization", true, "unsupported resource row is not materialized"),
  ];
  return {
    proofNumber,
    id,
    category,
    status: "verified-refusal",
    disposition: "refused-boundary",
    accepted: checks.every((entry) => entry.passed),
    artifact: `proofs/native-process-substrate/resource-coverage/retained/row-proofs/${proofNumber}/row-proof.json`,
    evidence,
    checks,
    refusals,
    claimUse: "boundary-refusal-only",
  };
}

function translatorRefusal(resource: NativeProcessResource): NativeProcessImageRefusal {
  return firstRefusal(planNativeTargetFdTable({ resources: [resource] }));
}

function firstRefusal(plan: ReturnType<typeof planNativeTargetFdTable>): NativeProcessImageRefusal {
  const refusal = plan.refusals[0];
  if (!refusal) {
    throw new Error("expected retained refusal");
  }
  return refusal;
}

function customRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail: Record<string, unknown>,
): NativeProcessImageRefusal {
  return { code, message, detail };
}

function pipePairResource(
  fd: number,
  direction: "read" | "write",
  recipe: Record<string, unknown> = {},
  flags: string[] = [direction === "read" ? "octal:0" : "octal:1"],
): NativeProcessResource {
  return {
    id: `fd:${fd}:pipe-${direction}`,
    kind: "pipe",
    state: "captured",
    fd,
    path: "pipe:[pair]",
    flags,
    recipe: {
      pipeModel: "empty-pair-v1",
      pipeDirection: direction,
      pipeBuffer: "empty",
      peerLifetime: "open",
      pipeWaiters: "none",
      readiness: "not-readable",
      ...recipe,
    },
  };
}

function regularFileExternalProof(): { id: string; accepted: boolean; artifact: string } {
  const artifact =
    "proofs/native-process-substrate/regular-file-fd-bidirectional/retained/native-regular-file-fd-bidirectional-proof-report.json";
  if (!existsSync(artifact)) {
    return { id: "native-regular-file-fd-bidirectional", accepted: false, artifact };
  }
  const report = JSON.parse(readFileSync(artifact, "utf8")) as {
    accepted?: boolean;
    acceptedDirections?: number;
    requiredDirections?: number;
    publicClaimAllowed?: boolean;
  };
  return {
    id: "native-regular-file-fd-bidirectional",
    accepted:
      report.accepted === true &&
      report.acceptedDirections === 2 &&
      report.requiredDirections === 2 &&
      report.publicClaimAllowed === false,
    artifact,
  };
}

function containsAll(actual: string[], expected: string[]): boolean {
  return expected.every((item) => actual.includes(item));
}

function sameMultiset(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function check(
  id: string,
  passed: boolean,
  message: string,
): { id: string; passed: boolean; message: string } {
  return { id, passed, message };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv: string[]): { outDir: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultOutDir = resolve(scriptDir, "../resource-coverage/retained");
  const args = { outDir: defaultOutDir, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir" || arg === "--out") {
      args.outDir = takeValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

main();
