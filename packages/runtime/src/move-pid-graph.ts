import { existsSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type {
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
  NativeProcessResource,
} from "./native-process-image.ts";
import type { NativeTargetFdTableEntry } from "./native-resource-translation.ts";
import type { TargetGuestRestoreResourceRecipe } from "./target-guest-restore-loader.ts";

export const MOVE_DESCRIPTOR_FORMAT_VERSION = 1 as const;
export const MOVE_REFUSAL_CODE = "move-unproven-state-class" as const;

export type MoveProcessStateClass =
  | "process-identity"
  | "argv-env-cwd"
  | "open-files"
  | "sockets"
  | "threads"
  | "unknown";

export interface MovePidGraphNode {
  pid: number;
  ppid: number | undefined;
  command: string;
  argv: string[];
  cwd: string | undefined;
  exe?: string;
}

export interface MovePidGraphEdge {
  fromPid: number;
  toPid: number;
  kind: "parent-child";
}

export interface MoveRefusalEvidence {
  stateClass: MoveProcessStateClass;
  reason: string;
  evidence: string;
  nextAction: string;
}

export interface MovePidGraph {
  formatVersion: typeof MOVE_DESCRIPTOR_FORMAT_VERSION;
  kind: "machinen.move.pid-graph";
  rootPid: number | undefined;
  scannedAt: string;
  nodes: MovePidGraphNode[];
  edges: MovePidGraphEdge[];
  translatedStateClasses: MoveProcessStateClass[];
  refusedStateClasses: MoveRefusalEvidence[];
}

/**
 * Generic resource graph evidence for `machinen move`.
 *
 * Product support is intentionally narrower than the full proof matrix. The
 * first user-facing product path is `generic-stdio-pipe-product-marker`: an
 * exact modeled finite stdio pipe graph with
 * `migration.productPath.kind="exact-live-capture"`, support proof
 * `generic-finite-pipe-buffer-replay`, refusal proof
 * `generic-pipe-stdio-refusals`, and `refusalClasses=[]`.
 *
 * Wave 2 adds only five more exact live-capture product markers:
 * `unix-pathname-listener-live-generic-primary-marker`,
 * `reader-cat-live-generic-primary-marker`,
 * `grep-live-generic-primary-marker`,
 * `busybox-nc-listener-live-generic-primary-marker`, and
 * `socat-file-responder-live-generic-primary-marker`. Their support/refusal
 * proof names are `generic-unix-pathname-listener`,
 * `generic-unix-pathname-listener-refusals`, `reader-cat`,
 * `generic-stale-file-identity-refusal`, `generic-deleted-file-fd-refusal`,
 * `generic-writable-file-cursor-refusal`, `grep`,
 * `generic-pipe-stdio-refusals`, `busybox-nc-listener`,
 * `unsafe-busybox-nc-refusal`, `unsafe-nc-active-refusal`,
 * `generic-loader-preflight-refusals`, `socat-file-responder`, and
 * `unsafe-socat-file-responder-refusal`. Wave-2 public support requires
 * `observedGraph="exact-live-resource-graph"`, `refusalClasses=[]`, retained
 * artifacts for the 19-row plan in
 * `scripts/smoke/move-envelope-productization-wave2-plan.json`, and the
 * release validation profile
 * `scripts/smoke/move-envelope-productization-wave2-validation-profile.json`.
 *
 * Proof-only same-arch continuation, proof-only cross-arch semantic
 * reconstruction, descriptor harnesses, Redis/database/service rows, active
 * sessions, source-fd teleportation, source-ISA emulation, metadata-only
 * success, runtime-profile shortcuts, broad daemon/database migration, and
 * arbitrary process restore are not product support. In short: no arbitrary
 * process restore.
 */
export interface MoveGenericResourceGraphState {
  policy: "generic-resource-graph-target-native-reexec-v1";
  migration?: {
    mode: "generic-primary" | "generic-equivalent-with-bespoke-fallback";
    sourceProofName: string;
    genericProofName: string;
    fallbackPolicy: string;
    boundary: string;
    productPath?: {
      kind: "exact-live-capture";
      markerProofName: string;
      supportProofName: string;
      refusalProofNames: string[];
      driftRefusalProofNames?: string[];
      observedGraph: "exact-single-process-service" | "exact-live-resource-graph";
    };
  };
  executableIdentity: {
    path: string;
    realPath?: string;
    packageName?: string;
    version?: string;
    architecture?: string;
    sha256?: string;
  };
  argv: string[];
  env: {
    policy: "captured-explicit" | "target-default" | "refused-if-observed";
    entries?: Record<string, string>;
  };
  cwd: {
    path: string;
    identity?: {
      fileCount: number;
      directoryCount: number;
      totalBytes: number;
      treeDigest: string;
    };
  };
  root?: {
    path: string;
  };
  uidGid?: {
    uid: number;
    gid: number;
    groups?: number[];
    umask?: string;
  };
  ports: Array<{
    protocol: "tcp";
    port: number;
    bindAddress: "127.0.0.1";
    state: "idle-loopback-listener";
    noActiveClients: true;
  }>;
  unixSockets?: Array<{
    fd?: number;
    path: string;
    inode: string;
    state: "idle-pathname-listener";
    noActiveClients: true;
    preflight: {
      targetPathPolicy: "must-not-exist";
      parentDirectoryPolicy: "must-exist-writable";
    };
  }>;
  regularFiles: Array<{
    fd?: number;
    path: string;
    access:
      | "read-only"
      | "write-atomic"
      | "append-only"
      | "append-only-refused"
      | "read-write-refused";
    flags?: string[];
    offset?: number;
    cursor?: {
      offset: number;
      policy: "read-only-offset" | "append-only-end" | "refused";
    };
    identity: {
      dev: number;
      inode: number;
      size: number;
      mtimeEpochSeconds: number;
      sha256: string;
    };
  }>;
  dataDirs: Array<{
    path: string;
    access: "read-only" | "write-validated";
    ownerUid?: number;
    ownerGid?: number;
    mode?: string;
    identity: {
      fileCount: number;
      directoryCount: number;
      totalBytes: number;
      treeDigest: string;
    };
  }>;
  fileOffsets: Array<{
    fd: number;
    offset: number;
    policy: "absolute-offset" | "refused-if-nonzero";
  }>;
  fileLocks?: Array<{
    fd?: number;
    path: string;
    lockType: "flock" | "posix" | "ofd";
    mode: "shared" | "exclusive";
    range: { start: number; length: number | "eof" };
    owner: { pid?: number; policy: "target-process" | "refused-unknown-owner" };
    fileIdentity: {
      dev?: number;
      inode?: number;
      size: number;
      sha256: string;
    };
    conflictPolicy: "must-acquire-nonblocking-before-launch";
    support: "target-native-advisory-lock" | "refused-baseline";
  }>;
  stdioPolicy:
    | "stdio-dev-null-or-closed"
    | "stdio-inherited-noninteractive"
    | "refuse-nontrivial-stdio";
  stdioGraph?: {
    policy:
      | "dev-null-or-closed"
      | "modeled-pipe"
      | "modeled-pty-transcript"
      | "inherited-noninteractive"
      | "refused";
    fds: Array<{
      fd: 0 | 1 | 2;
      target: "closed" | "dev-null" | "pipe" | "regular-file" | "pty" | "refused";
      access: "read" | "write" | "read-write";
      evidence: string;
    }>;
  };
  pipeGraph?: {
    pipes: Array<{
      inode: string;
      readFds: Array<{
        pid: number;
        fd: number;
        role: "producer" | "consumer" | "unknown";
        insideMovedGraph: boolean;
        flags: string[];
        cloexec?: boolean;
        nonblocking?: boolean;
        command?: string;
        argv?: string[];
      }>;
      writeFds: Array<{
        pid: number;
        fd: number;
        role: "producer" | "consumer" | "unknown";
        insideMovedGraph: boolean;
        flags: string[];
        cloexec?: boolean;
        nonblocking?: boolean;
        command?: string;
        argv?: string[];
      }>;
      topology: "one-producer-one-consumer" | "fan-in" | "fan-out" | "cycle" | "missing-peer";
      bufferedDataPolicy: "empty" | "captured-bytes" | "refused-unknown";
      capturedBytesBase64?: string;
      lifecycle: "finite-replay" | "long-running-pair" | "refused";
    }>;
  };
  eventfds?: Array<{
    fd: number;
    path: "anon_inode:[eventfd]";
    counter: string;
    fdinfoFlags?: string;
    flags: string[];
    semaphore?: boolean;
    nonblocking?: boolean;
    cloexec?: boolean;
    support: "refused-baseline" | "target-native-counter";
  }>;
  epolls?: Array<{
    fd: number;
    path: "anon_inode:[eventpoll]";
    fdinfoFlags?: string;
    flags: string[];
    watchedFds: Array<{
      targetFd: number;
      events: string;
      data: string;
      trigger: "level" | "edge" | "unknown";
      oneShot: boolean;
      watchedResourceClass: string;
    }>;
    support: "refused-baseline" | "target-native-eventfd-watch" | "target-native-timerfd-watch";
  }>;
  timers?: Array<{
    fd: number;
    path: "anon_inode:[timerfd]";
    fdinfoFlags?: string;
    flags: string[];
    clockId: number | "unknown";
    ticks: string;
    settimeFlags: number | "unknown";
    valueSeconds: number;
    valueNanoseconds: number;
    intervalSeconds: number;
    intervalNanoseconds: number;
    restartPolicy: "monotonic-relative-oneshot-target-native" | "refused-baseline";
    boundedSkewMilliseconds: number;
    support: "refused-baseline" | "target-native-relative-oneshot";
  }>;
  signalState?: {
    sessionId?: number;
    processGroupId?: number;
    pendingMaskHex: string;
    sharedPendingMaskHex: string;
    blockedMaskHex: string;
    ignoredMaskHex: string;
    caughtMaskHex: string;
    dispositionPolicy: "recorded-default-ignored-caught-masks";
    pendingPolicy: "refuse-nonzero-pending";
    processGroupPolicy: "single-process-group" | "refused-ambiguous-process-group";
    support: "refused-baseline";
  };
  signalfds?: Array<{
    fd: number;
    path: "anon_inode:[signalfd]";
    fdinfoFlags?: string;
    flags: string[];
    sigmask: string;
    support: "refused-baseline";
  }>;
  inotifyWatches?: Array<{
    fd: number;
    path: "anon_inode:[inotify]";
    fdinfoFlags?: string;
    flags: string[];
    watches: Array<{
      wd: number;
      path: string;
      mask: string;
      ignoredMask: string;
      fileIdentity: { size: number; sha256: string };
      eventPolicy: "future-events-only-no-queue-replay" | "refused-baseline";
    }>;
    eventPolicy: "future-events-only-no-queue-replay" | "refused-baseline";
    support: "refused-baseline" | "target-native-file-follow";
  }>;
  mmapMappings?: Array<{
    fd?: number;
    path: string;
    offset: number;
    length: number;
    permissions: "r--" | "rw-" | "r-x";
    sharing: "private" | "shared";
    fileIdentity: { size: number; sha256: string };
    dirtyPolicy: "clean-file-backed" | "refused-dirty";
    support: "refused-baseline" | "target-native-file-backed-clean";
  }>;
  crossArchSemanticReconstruction?: {
    support: "proof-only-target-native-semantic-reconstruction" | "refused-baseline";
    sourceArch: string;
    targetArch: string;
    semanticDescriptor: {
      kind: "finite-byte-stream-transform";
      operation: "uppercase" | "refused";
      descriptorSha256: string;
      inputSha256: string;
      sourceRegistersPresent: boolean;
      sourceIsaStatePresent: boolean;
      metadataOnlySuccess: boolean;
    };
    resourceGraph: {
      allObservedResourceClassesModeled: boolean;
      modeledClasses: string[];
    };
    targetNativeTool: {
      path: string;
      argv: string[];
      observedArch: string;
      status: "completed" | "refused";
    };
    continuationEvidence: {
      stdout: string;
      stdoutSha256: string;
      targetNativeExecution: boolean;
      sourceIsaEmulationUsed: boolean;
      sidecarRuntimeUsed: boolean;
    };
  };
  sameArchContinuation?: {
    support: "proof-only-single-thread-target-native-resume-harness" | "refused-baseline";
    sourceArch: string;
    targetArch: string;
    thread: {
      id: string;
      state: "frozen-ptrace-stop-proof-fixture" | "refused";
      singleThread: boolean;
      registers: Record<string, string>;
    };
    stack: {
      policy: "single-stack-window-modeled" | "refused";
      base: string;
      stackPointer: string;
      returnAddress: string;
      materialization: "target-native-call-stack" | "refused";
    };
    memoryMappings: Array<{
      id: string;
      sourceStart: string;
      targetEntry: string;
      permissions: "r-x" | "r--" | "rw-";
      bytesSha256: string;
      sizeBytes: number;
    }>;
    fdGraph: {
      policy: "all-observed-fds-modeled" | "refused";
      observedFds: number[];
      compatibility: string;
    };
    resourceGraph: {
      allObservedResourceClassesModeled: boolean;
      modeledClasses: string[];
    };
    resume: {
      arch: string;
      status: "returned" | "refused";
      inputRegister: string;
      inputValue: number;
      returnRegister: string;
      returnValue: number;
      targetNativeCodeBytesSha256: string;
      mappedExecutableBytes: number;
      sourceIsaEmulationUsed: boolean;
      sidecarRuntimeUsed: boolean;
      entryHex: string;
    };
  };
  ptys?: Array<{
    fd: number;
    path: string;
    fdinfoFlags?: string;
    sessionId?: number;
    processGroupId?: number;
    terminalProcessGroupId?: number;
    ttyNumber?: number;
    winsize?: { rows: number; columns: number };
    termios: string;
    transcriptProbe?: {
      policy: "target-native-reexec-capture-output";
      marker: "--machinen-pty-transcript-probe";
    };
    support:
      | "refused-interactive-terminal-boundary"
      | "target-native-noninteractive-transcript-probe";
  }>;
  healthProbe:
    | { kind: "process-alive" }
    | { kind: "http"; url: string; expectedStatus?: number; expectedBodySha256?: string }
    | { kind: "tcp-connect"; host: "127.0.0.1"; port: number; expectedBannerSha256?: string }
    | { kind: "unix-connect"; path: string }
    | { kind: "command"; argv: string[]; expectedStdoutSha256?: string };
  resourceClasses: Array<{
    resourceClass: string;
    status: "supported" | "refused" | "unknown" | "deferred" | "ignorable";
    evidence: string;
  }>;
  refusalClasses: Array<{
    resourceClass: string;
    status: "refused" | "unknown" | "deferred";
    reason: string;
    evidence: string;
    nextAction: string;
  }>;
  capturedAt?: string;
}

export interface MovePostgresClusterState {
  port: number;
  bindAddress: "127.0.0.1";
  dataDir: string;
  packageIdentity: {
    packageName: "postgresql-15";
    version: string;
    architecture: string;
    executable: "/usr/lib/postgresql/15/bin/postgres";
  };
  clientPackageIdentity: {
    packageName: "postgresql-client-15";
    version: string;
    architecture: string;
  };
  clusterIdentity: {
    pgVersion: string;
    dataDirOwnerUid: number;
    dataDirOwnerGid: number;
    dataDirMode: string;
    treeEntryCount: number;
    treeDigest: string;
    pgControlSha256: string;
    postgresqlConfSha256: string;
    pgHbaConfSha256: string;
  };
  walState: {
    policy: "clean-checkpoint-required";
    pgWalDigest: string;
    currentWalFiles: string[];
    checkpointEvidence: string;
  };
  runtimeState: {
    processShape: "postmaster-plus-standard-background-workers";
    activeExternalClients: 0;
    nonIdleUserBackends: 0;
    preparedTransactions: 0;
    replicationSlots: 0;
    nonDefaultTablespaces: 0;
    unloggedRelations: 0;
    tempFiles: 0;
    symlinkEscapes: 0;
    extensionNativeLibraries: 0;
  };
  policy: "postgres-idle-clean-cluster-target-native-restart";
  capturedAt?: string;
}

export interface MoveDescriptor extends Omit<MovePidGraph, "kind"> {
  kind: "machinen.move.descriptor";
  target: "cross-isa-target-native-pid-translation";
  productSurface: "machinen move";
  resourcePlan?: {
    kind: "machinen.move.resource-plan";
    source: "guest-procfs" | "host-procfs";
    sourceArch?: NativeProcessImageArchitecture;
    resources: NativeProcessResource[];
    fdTableEntries: NativeTargetFdTableEntry[];
    targetGuestResources: TargetGuestRestoreResourceRecipe[];
    refusals: NativeProcessImageRefusal[];
    acceptedSubsets: string[];
    capture?: {
      sourceVm?: { pid: number; name?: string };
      executablePackage?: {
        path: string;
        realPath?: string;
        packageName?: string;
        version?: string;
        architecture?: string;
      };
      pingState?: {
        ntransmitted: number;
        nreceived: number;
        nerrors: number;
        lastSequence?: number;
      };
      sleepState?: {
        originalMs: number;
        elapsedMs: number;
        remainingMs: number;
        capturedAt?: string;
      };
      tailState?: {
        path: string;
        offset: number;
        followMode: "poll-or-inotify";
        capturedAt?: string;
      };
      lessState?: {
        path: string;
        line: number;
        terminal: "script-pty";
        capturedAt?: string;
      };
      viState?: {
        path: string;
        line: number;
        mode: "normal-read-only" | "normal-dirty-buffer";
        terminal: "script-pty";
        dirtyText?: string;
        searchPattern?: string;
        capturedAt?: string;
      };
      readerState?: {
        command: "cat";
        path: string;
        offset: number;
        outputPath?: string;
        capturedAt?: string;
      };
      grepState?: {
        pattern: string;
        path: string;
        offset: number;
        outputPath?: string;
        capturedAt?: string;
      };
      watchState?: {
        intervalSeconds: number;
        command: string[];
        capturedAt?: string;
      };
      shellState?: {
        shell: "sh" | "dash";
        cwd: string;
        terminal: "script-pty";
        capturedAt?: string;
      };
      httpState?: {
        executable: "python3";
        port: number;
        cwd: string;
        directory?: string;
        bindAddress?: "127.0.0.1";
        mode?: "explicit-bind-cwd" | "explicit-bind-directory";
        listenerState?: "idle-single-listener";
        directoryIdentity?: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        capturedAt?: string;
      };
      busyboxHttpState?: {
        port: number;
        root: string;
        bindAddress?: "127.0.0.1";
        capturedAt?: string;
      };
      ncState?: {
        port: number;
        capturedAt?: string;
      };
      busyboxNcState?: {
        port: number;
        argvContract: "busybox-nc-listen-p";
        listenerState: "idle-single-listener";
        capturedAt?: string;
      };
      socatFileResponderState?: {
        port: number;
        filePath: string;
        fileIdentity: { size: number; sha256: string };
        argvContract: "socat-tcp-listen-fork-reuseaddr-file";
        listenerState: "idle-single-listener";
        binaryPolicy: "proof-provisioned-target-native-socat";
        capturedAt?: string;
      };
      redisIdleState?: {
        port: number;
        argvContract: "redis-server-no-persistence-port";
        datasetState: "empty";
        clientState: "idle-no-external-clients";
        persistence: { save: ""; appendonly: "no" };
        binaryPolicy: "proof-provisioned-target-native-redis";
        capturedAt?: string;
      };
      postgresClusterState?: MovePostgresClusterState;
      genericResourceGraphState?: MoveGenericResourceGraphState;
      nginxStaticState?: {
        configPath: string;
        configSha256: string;
        root: string;
        port: number;
        configContract: "nginx-static-root-local-listen-try-files-404";
        listenerState: "idle-single-listener";
        directoryIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        binaryPolicy: "proof-provisioned-target-native-nginx";
        capturedAt?: string;
      };
      caddyStaticState?: {
        port: number;
        root: string;
        argvContract: "caddy-file-server-listen-root";
        listenerState: "idle-single-listener";
        directoryIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        binaryPolicy: "proof-provisioned-target-native-caddy";
        capturedAt?: string;
      };
      rubyHttpState?: {
        port: number;
        root: string;
        argvContract: "ruby-run-httpd-root-port";
        listenerState: "idle-single-listener";
        directoryIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        binaryPolicy: "proof-provisioned-target-native-ruby";
        capturedAt?: string;
      };
      phpStaticState?: {
        port: number;
        root: string;
        argvContract: "php-built-in-server-local-root";
        dynamicPolicy: "no-php-scripts";
        listenerState: "idle-single-listener";
        directoryIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        binaryPolicy: "proof-provisioned-target-native-php";
        capturedAt?: string;
      };
      rsyncDaemonState?: {
        configPath: string;
        configSha256: string;
        moduleName: string;
        root: string;
        port: number;
        policy: "read-only-module-no-auth-hooks";
        listenerState: "idle-single-listener-no-active-clients";
        directoryIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
        };
        binaryPolicy: "proof-provisioned-target-native-rsync";
        capturedAt?: string;
      };
      envState?: {
        key: "MACHINEN_MOVE_ENV_PROOF";
        value: string;
        child: "python-http-server";
        capturedAt?: string;
      };
      timeoutState?: {
        seconds: number;
        child: "python-http-server";
        httpState: {
          executable: "python3";
          port: number;
          cwd: string;
          directory?: string;
          bindAddress?: "127.0.0.1";
          mode?: "explicit-bind-cwd" | "explicit-bind-directory";
          listenerState?: "idle-single-listener";
          directoryIdentity?: {
            fileCount: number;
            directoryCount: number;
            totalBytes: number;
            treeDigest: string;
          };
        };
        capturedAt?: string;
      };
      pythonStaticRouteState?: {
        executable: "python3";
        scriptPath: string;
        cwd: string;
        port: number;
        route: string;
        expectedBody: string;
        capturedAt?: string;
      };
      goStaticHttpState?: {
        binaryPath: string;
        cwd: string;
        markerVersion: "go-static-http-v1";
        port: number;
        healthPath: string;
        capturedAt?: string;
      };
      rustStaticHttpState?: {
        binaryPath: string;
        cwd: string;
        markerVersion: "rust-static-http-v1";
        port: number;
        healthPath: string;
        capturedAt?: string;
      };
      tailGrepPipelineState?: {
        tailPath: string;
        offset: number;
        pattern: string;
        lineBuffered: boolean;
        capturedAt?: string;
      };
      ddState?: {
        inputPath: string;
        outputPath: string;
        blockSize: number;
        inputOffset: number;
        outputOffset: number;
        capturedAt?: string;
      };
      cpState?: {
        sourcePath: string;
        destinationPath: string;
        sourceOffset: number;
        destinationOffset: number;
        capturedAt?: string;
      };
      mvState?: {
        sourcePath: string;
        destinationPath: string;
        capturedAt?: string;
      };
      headState?: {
        path: string;
        lines: number;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      tailLinesState?: {
        path: string;
        lines: number;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      sedState?:
        | {
            path: string;
            scriptKind: "print-range";
            startLine: number;
            endLine: number;
            fileIdentity: { size: number; sha256: string };
            outputPath?: string;
            capturedAt?: string;
          }
        | {
            path: string;
            scriptKind: "literal-substitution";
            pattern: string;
            replacement: string;
            fileIdentity: { size: number; sha256: string };
            outputPath?: string;
            capturedAt?: string;
          };
      awkFieldState?: {
        path: string;
        fieldIndex: number;
        fs: "default-whitespace";
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      cutState?: {
        path: string;
        delimiter: string;
        fields: string;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      pasteState?: {
        leftPath: string;
        rightPath: string;
        leftIdentity: { size: number; sha256: string };
        rightIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      uniqState?: {
        path: string;
        count: boolean;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      commState?: {
        leftPath: string;
        rightPath: string;
        leftIdentity: { size: number; sha256: string };
        rightIdentity: { size: number; sha256: string };
        collation: "C";
        outputPath?: string;
        capturedAt?: string;
      };
      joinState?: {
        leftPath: string;
        rightPath: string;
        leftIdentity: { size: number; sha256: string };
        rightIdentity: { size: number; sha256: string };
        key: "default-first-field";
        collation: "C";
        outputPath?: string;
        capturedAt?: string;
      };
      sortState?: {
        path: string;
        outputPath?: string;
        capturedAt?: string;
      };
      wcState?: {
        path: string;
        mode: "lines";
        outputPath?: string;
        capturedAt?: string;
      };
      sha256State?: {
        path: string;
        expectedDigest: string;
        outputPath?: string;
        capturedAt?: string;
      };
      checksumState?: {
        algorithm: "md5" | "sha1" | "sha512";
        path: string;
        expectedDigest: string;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      base64State?: {
        path: string;
        wrap: 76;
        fileIdentity: { size: number; sha256: string };
        outputPath?: string;
        capturedAt?: string;
      };
      gzipState?: {
        inputPath: string;
        outputPath: string;
        fileIdentity: { size: number; sha256: string };
        outputPolicy: "atomic-temp-rename";
        capturedAt?: string;
      };
      gunzipState?: {
        inputPath: string;
        outputPath: string;
        fileIdentity: { size: number; sha256: string };
        outputPolicy: "atomic-temp-rename";
        capturedAt?: string;
      };
      xzState?: {
        inputPath: string;
        outputPath: string;
        fileIdentity: { size: number; sha256: string };
        outputPolicy: "atomic-temp-rename";
        capturedAt?: string;
      };
      zstdState?: {
        inputPath: string;
        outputPath: string;
        fileIdentity: { size: number; sha256: string };
        outputPolicy: "atomic-temp-rename";
        capturedAt?: string;
      };
      findState?: {
        rootPath: string;
        outputPath?: string;
        lastPath?: string;
        capturedAt?: string;
      };
      tarState?: {
        archivePath: string;
        sourceDir: string;
        capturedAt?: string;
      };
      tarExtractState?: {
        archivePath: string;
        targetDir: string;
        archiveIdentity: { size: number; sha256: string };
        entryCount: number;
        policy: "safe-relative-regular-empty-target";
        capturedAt?: string;
      };
      zipCreateState?: {
        archivePath: string;
        sourceDir: string;
        sourceIdentity: { fileCount: number; treeDigest: string };
        policy: "safe-relative-regular-no-symlinks-absent-archive";
        capturedAt?: string;
      };
      mkdirState?: {
        targetPath: string;
        parentPath: string;
        parentIdentity: { mode: string; entriesDigest: string };
        policy: "absent-child-existing-parent";
        capturedAt?: string;
      };
      mkdirParentsState?: {
        targetPath: string;
        existingPrefix: string;
        missingComponents: string[];
        prefixIdentity: { mode: string; entriesDigest: string };
        policy: "symlink-free-path-idempotent-or-create-missing";
        capturedAt?: string;
      };
      touchState?: {
        path: string;
        parentPath: string;
        timestampSpec: string;
        expectedEpoch: number;
        parentIdentity: { mode: string; entriesDigest: string };
        policy: "deterministic-timestamp-absent-file-create";
        capturedAt?: string;
      };
      chmodState?: {
        path: string;
        expectedMode: string;
        targetMode: string;
        fileIdentity: { size: number; sha256: string };
        policy: "numeric-mode-regular-non-symlink";
        capturedAt?: string;
      };
      chownState?: {
        path: string;
        owner: string;
        group: string;
        targetUid: number;
        targetGid: number;
        expectedUid: number;
        expectedGid: number;
        fileIdentity: { size: number; sha256: string };
        policy: "same-base-uid-gid-regular-non-symlink";
        capturedAt?: string;
      };
      linkState?: {
        sourcePath: string;
        destinationPath: string;
        sourceIdentity: { dev: string; inode: string; mode: string; size: number; sha256: string };
        destinationParent: string;
        destinationParentIdentity: { dev: string; mode: string; entriesDigest: string };
        policy: "hardlink-regular-source-absent-destination-same-filesystem";
        capturedAt?: string;
      };
      symlinkState?: {
        targetLiteral: string;
        linkPath: string;
        parentPath: string;
        parentIdentity: { dev: string; mode: string; entriesDigest: string };
        policy: "literal-target-absent-link-safe-parent";
        capturedAt?: string;
      };
      rmState?: {
        path: string;
        parentPath: string;
        fileIdentity: { mode: string; size: number; sha256: string };
        parentIdentity: { dev: string; mode: string; entriesDigest: string };
        policy: "regular-non-symlink-pre-unlink";
        capturedAt?: string;
      };
      rmdirState?: {
        path: string;
        parentPath: string;
        directoryIdentity: { dev: string; inode: string; mode: string };
        parentIdentity: { dev: string; mode: string; entriesDigest: string };
        policy: "empty-directory-non-symlink-pre-remove";
        capturedAt?: string;
      };
      installState?: {
        sourcePath: string;
        destinationPath: string;
        mode: string;
        sourceIdentity: { mode: string; size: number; sha256: string };
        destinationParent: string;
        destinationParentIdentity: { dev: string; mode: string; entriesDigest: string };
        policy: "copy-mode-absent-destination";
        capturedAt?: string;
      };
      lsState?: {
        directoryPath: string;
        directoryIdentity: {
          dev: string;
          inode: string;
          mode: string;
          entryCount: number;
          entriesDigest: string;
          outputDigest: string;
        };
        ordering: "LC_ALL=C-name-ascending";
        options: ["-1"];
        outputPath?: string;
        policy: "ascii-names-non-recursive-directory-listing";
        capturedAt?: string;
      };
      lsLongState?: {
        directoryPath: string;
        directoryIdentity: {
          dev: string;
          inode: string;
          mode: string;
          entryCount: number;
          entriesDigest: string;
          outputDigest: string;
        };
        entries: Array<{
          name: string;
          kind: "file" | "directory";
          mode: string;
          permissions: string;
          size: number;
          uid: number;
          gid: number;
          owner: string;
          group: string;
          mtimeEpoch: number;
        }>;
        ordering: "LC_ALL=C-name-ascending";
        statPolicy: "regular-or-directory-no-symlinks-owner-group-mapped";
        options: ["-l"];
        outputPath?: string;
        policy: "ascii-names-non-recursive-long-listing";
        capturedAt?: string;
      };
      duState?: {
        directoryPath: string;
        rootDevice: string;
        treeIdentity: {
          entryCount: number;
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
          outputDigest: string;
        };
        options: ["-s", "-b"];
        symlinkPolicy: "no-symlinks";
        mountPolicy: "single-device-no-mount-crossing";
        outputPath?: string;
        capturedAt?: string;
      };
      statState?: {
        path: string;
        format: "default";
        options: [];
        fileIdentity: {
          fileType: "regular file";
          mode: string;
          permissions: string;
          size: number;
          uid: number;
          gid: number;
          mtimeEpoch: number;
          sha256: string;
        };
        outputPath?: string;
        symlinkPolicy: "no-symlinks";
        capturedAt?: string;
      };
      readlinkState?: {
        linkPath: string;
        targetLiteral: string;
        linkIdentity: { mode: string; targetDigest: string };
        options: [];
        policy: "direct-symlink-literal-target";
        outputPath?: string;
        capturedAt?: string;
      };
      realpathState?: {
        cwd: string;
        inputPath: string;
        resolvedPath: string;
        chainIdentity: { componentCount: number; symlinkCount: number; chainDigest: string };
        outputDigest: string;
        options: [];
        policy: "absolute-existing-path-safe-chain";
        outputPath?: string;
        capturedAt?: string;
      };
      recursiveGrepState?: {
        rootPath: string;
        pattern: string;
        patternPolicy: "literal-safe-basic-regexp";
        treeIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
          outputDigest: string;
        };
        options: ["-r"];
        binaryPolicy: "text-files-only";
        symlinkPolicy: "no-symlinks";
        outputPath?: string;
        capturedAt?: string;
      };
      maxdepthFindState?: {
        rootPath: string;
        maxdepth: number;
        treeIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
          outputDigest: string;
        };
        options: ["-maxdepth", "-type", "-print"];
        symlinkPolicy: "no-symlinks";
        outputPath?: string;
        capturedAt?: string;
      };
      findPredicateState?: {
        rootPath: string;
        predicate: { kind: "mtime" | "size"; value: string };
        treeIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
          outputDigest: string;
        };
        options: ["predicate", "-type", "-print"];
        symlinkPolicy: "no-symlinks";
        policy: "bounded-simple-find-predicate";
        outputPath?: string;
        capturedAt?: string;
      };
      treeState?: {
        rootPath: string;
        options: [];
        treeIdentity: {
          fileCount: number;
          directoryCount: number;
          totalBytes: number;
          treeDigest: string;
          outputDigest: string;
        };
        symlinkPolicy: "no-symlinks";
        binaryPolicy: "proof-provisioned-target-native-tree";
        outputPath?: string;
        capturedAt?: string;
      };
      nodeStaticHttpState?: {
        scriptPath: string;
        cwd: string;
        port: number;
        healthPath: string;
        rootDir?: string;
        argvContract?: "--port-root-static-http-v1";
        capturedAt?: string;
      };
      safeBoundary?: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string };
      freeze?: { state: "ptrace-attached" | "refused"; detail: string };
      tasks?: number;
      wchan?: string;
      syscall?: string;
      maps?: string[];
      registers?: Record<string, unknown>;
    };
  };
  nativeContinuation?: {
    kind: "machinen.move.native-continuation";
    bundlePath: ".";
    activeSyscallPlan: "active-syscall-plan.json";
    state: "planned" | "refused";
    refusals: NativeProcessImageRefusal[];
  };
}

export interface MoveSaveResult {
  accepted: boolean;
  descriptorPath: string;
  descriptor: MoveDescriptor;
  refusalCode?: typeof MOVE_REFUSAL_CODE;
  issueReport?: MoveIssueReport;
}

export interface MoveIssueReport {
  title: string;
  body: string;
  repository: string;
}

export function scanMovePidGraph(rootPid?: number): MovePidGraph {
  const nodes = readProcNodes(rootPid);
  const pidSet = new Set(nodes.map((node) => node.pid));
  const edges = nodes
    .filter((node) => node.ppid !== undefined && pidSet.has(node.ppid))
    .map((node) => ({ fromPid: node.ppid!, toPid: node.pid, kind: "parent-child" as const }));
  return {
    formatVersion: MOVE_DESCRIPTOR_FORMAT_VERSION,
    kind: "machinen.move.pid-graph",
    rootPid,
    scannedAt: new Date().toISOString(),
    nodes,
    edges,
    translatedStateClasses: ["process-identity", "argv-env-cwd"],
    refusedStateClasses: buildRefusals(rootPid, nodes),
  };
}

export function createMoveDescriptor(pid: number): MoveDescriptor {
  const graph = scanMovePidGraph(pid);
  return {
    ...graph,
    kind: "machinen.move.descriptor",
    target: "cross-isa-target-native-pid-translation",
    productSurface: "machinen move",
  };
}

export function saveMoveDescriptor(input: {
  pid: number;
  outPath: string;
  issue?: boolean;
  issueRepo?: string;
}): MoveSaveResult {
  const descriptor = createMoveDescriptor(input.pid);
  const descriptorPath = resolve(input.outPath);
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  const accepted = descriptor.refusedStateClasses.length === 0;
  return {
    accepted,
    descriptorPath,
    descriptor,
    refusalCode: accepted ? undefined : MOVE_REFUSAL_CODE,
    issueReport: input.issue
      ? buildMoveIssueReport(descriptor, input.issueRepo ?? "redwoodjs/machinen")
      : undefined,
  };
}

export function loadMoveDescriptor(path: string): MoveDescriptor {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as Partial<MoveDescriptor>;
  if (parsed.kind !== "machinen.move.descriptor") {
    throw new Error("move descriptor kind must be machinen.move.descriptor");
  }
  if (parsed.formatVersion !== MOVE_DESCRIPTOR_FORMAT_VERSION) {
    throw new Error(`move descriptor formatVersion must be ${MOVE_DESCRIPTOR_FORMAT_VERSION}`);
  }
  if (parsed.productSurface !== "machinen move") {
    throw new Error("move descriptor productSurface must be machinen move");
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.refusedStateClasses)) {
    throw new Error("move descriptor must include nodes and refusedStateClasses arrays");
  }
  return parsed as MoveDescriptor;
}

export function buildMoveIssueReport(
  descriptor: MoveDescriptor,
  repository = "redwoodjs/machinen",
): MoveIssueReport {
  const stateClasses = descriptor.refusedStateClasses.map((item) => item.stateClass).join(", ");
  return {
    repository,
    title: `move refused PID ${descriptor.rootPid ?? "unknown"}: ${stateClasses || "no refusals"}`,
    body: [
      "## Problem",
      "`machinen move` refused this PID graph because some state classes are not proven yet.",
      "",
      "## Redacted evidence",
      `- root pid: ${descriptor.rootPid ?? "unknown"}`,
      `- process count: ${descriptor.nodes.length}`,
      `- refused classes: ${stateClasses || "none"}`,
      "",
      "## Next action",
      ...descriptor.refusedStateClasses.map((item) => `- ${item.stateClass}: ${item.nextAction}`),
    ].join("\n"),
  };
}

function readProcNodes(rootPid: number | undefined): MovePidGraphNode[] {
  if (rootPid !== undefined) {
    return [readProcNode(rootPid)];
  }
  if (!existsSync("/proc")) {
    return [fallbackNode(process.pid)];
  }
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .slice(0, 250)
    .map((entry) => readProcNode(Number(entry)))
    .sort((left, right) => left.pid - right.pid);
}

function readProcNode(pid: number): MovePidGraphNode {
  if (!existsSync(`/proc/${pid}`)) {
    return fallbackNode(pid);
  }
  const stat = readOptional(`/proc/${pid}/stat`);
  const argv = splitProc0(readOptional(`/proc/${pid}/cmdline`));
  const command = argv[0] ?? parseStatCommand(stat) ?? `pid-${pid}`;
  return {
    pid,
    ppid: parsePpid(stat),
    command: basename(command),
    argv,
    cwd: undefined,
    exe: readlinkProcExe(pid),
  };
}

function readlinkProcExe(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return undefined;
  }
}

function fallbackNode(pid: number): MovePidGraphNode {
  return {
    pid,
    ppid: pid === process.pid ? process.ppid : undefined,
    command: pid === process.pid ? basename(process.argv[0] ?? "node") : `pid-${pid}`,
    argv: pid === process.pid ? process.argv : [],
    cwd: pid === process.pid ? process.cwd() : undefined,
    exe: pid === process.pid ? process.execPath : undefined,
  };
}

function buildRefusals(
  rootPid: number | undefined,
  nodes: MovePidGraphNode[],
): MoveRefusalEvidence[] {
  return [
    {
      stateClass: "open-files",
      reason: "open file descriptor identity is not translated by this descriptor yet",
      evidence:
        rootPid === undefined ? "scan-only-no-root-pid" : `pid:${rootPid}:fd-audit-required`,
      nextAction: "add a move-owned fd detector and target-native file/socket reconstruction proof",
    },
    {
      stateClass: "sockets",
      reason:
        "kernel socket identity is not preserved across ISA and must be reconstructed or refused",
      evidence: `nodes:${nodes.length}:socket-audit-required`,
      nextAction: "attach socket-family evidence and a target-native reconstruction verifier",
    },
  ];
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function splitProc0(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function parsePpid(stat: string): number | undefined {
  const afterName = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  const parsed = Number(afterName[1]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseStatCommand(stat: string): string | undefined {
  const match = /^\d+ \((.*)\)/.exec(stat);
  return match?.[1];
}
