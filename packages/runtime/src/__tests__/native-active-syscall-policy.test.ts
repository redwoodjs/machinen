import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyNativeActiveSyscalls,
  modelNativeFdReadState,
  modelNativeFdWriteState,
  modelNativePpollTimeoutState,
  modelNativeSleepTimerState,
} from "../native-active-syscall-policy.ts";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeProcessImageDocuments,
  type NativeThreadState,
} from "../native-process-image.ts";

const tempDirs: string[] = [];

function thread(syscall: NativeThreadState["syscall"]): NativeThreadState {
  return {
    id: `thread:${syscall.name ?? syscall.state}`,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: { arch: "arm64", pc: "0x1000", sp: "0x2000", pstate: "0x0", x: [] },
    syscall,
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
    tls: { threadPointer: "0x0", rseq: { state: "absent" } },
  };
}

function arm64SleepThread(
  syscall: NativeThreadState["syscall"] = {
    state: "inside-syscall",
    number: 115,
    name: "clock_nanosleep",
  },
  x: string[] = ["0x0", "0x0", "0x3000", "0x0", "0x0", "0x0"],
): NativeThreadState {
  return {
    ...thread(syscall),
    sourceRegisters: {
      arch: "arm64",
      pc: "0x1000",
      sp: "0x2000",
      pstate: "0x0",
      x: [...x, ...Array.from({ length: 31 - x.length }, () => "0x0")],
    },
  };
}

function arm64PpollThread(
  syscall: NativeThreadState["syscall"] = {
    state: "inside-syscall",
    number: 73,
    name: "ppoll",
  },
  x: string[] = ["0x0", "0x0", "0x3000", "0x0", "0x0", "0x0"],
): NativeThreadState {
  return arm64SleepThread(syscall, x);
}

function arm64ReadThread(
  x: string[] = ["0x20", "0x3100", "0x1", "0x0", "0x0", "0x0"],
): NativeThreadState {
  return arm64SleepThread({ state: "inside-syscall", number: 63, name: "read" }, x);
}

function arm64WriteThread(
  x: string[] = ["0x27", "0x3100", "0x4", "0x0", "0x0", "0x0"],
): NativeThreadState {
  return arm64SleepThread({ state: "inside-syscall", number: 64, name: "write" }, x);
}

function arm64SocketThread(
  name: "accept" | "accept4" | "connect",
  x: string[] = ["0x28", "0x0", "0x0", "0x0", "0x0", "0x0"],
): NativeThreadState {
  const number = name === "connect" ? 203 : name === "accept4" ? 242 : 202;
  return arm64SleepThread({ state: "inside-syscall", number, name }, x);
}

function arm64EpollThread(
  name: "epoll_wait" | "epoll_pwait" | "epoll_pwait2" = "epoll_wait",
  x: string[] = ["0x30", "0x4100", "0x4", "0xffffffff", "0x0", "0x0"],
): NativeThreadState {
  return arm64SleepThread({ state: "inside-syscall", number: 22, name }, x);
}

function arm64FutexThread(
  name: "futex" | "futex_waitv" = "futex",
  x: string[] = ["0x5000", "0x0", "0x1", "0x0", "0x0", "0x0"],
): NativeThreadState {
  return arm64SleepThread({ state: "inside-syscall", number: 98, name }, x);
}

function documentsWithTimespec(options: {
  activeThread: NativeThreadState;
  seconds?: bigint;
  nanoseconds?: bigint;
  pollFd?: { fd: number; events: number; revents: number };
  pollFdResource?:
    | "missing"
    | {
        kind?: "pipe" | "file" | "socket" | "eventfd" | "timer";
        flags?: string[];
        path?: string;
        recipe?: Record<string, unknown>;
      };
}): NativeProcessImageDocuments {
  const rootDir = mkdtempSync(join(tmpdir(), "machinen-sleep-timer-state-"));
  tempDirs.push(rootDir);
  const memory = Buffer.alloc(4096);
  memory.writeBigUInt64LE(options.seconds ?? 30n, 0);
  memory.writeBigUInt64LE(options.nanoseconds ?? 123n, 8);
  if (options.pollFd) {
    memory.writeInt32LE(options.pollFd.fd, 0x100);
    memory.writeInt16LE(options.pollFd.events, 0x104);
    memory.writeInt16LE(options.pollFd.revents, 0x106);
  }
  writeFileSync(join(rootDir, NATIVE_PROCESS_IMAGE_FILES.memory), memory);
  return {
    rootDir,
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 4242 },
      target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
      process: { exe: "/bin/sleep", argv: ["sleep", "30"], env: {}, cwd: "/" },
      refusals: emptyRefusals(),
    },
    mappings: {
      formatVersion: 1,
      mappings: [
        {
          id: "mapping:stack",
          kind: "stack",
          sourceStart: "0x3000",
          sourceEnd: "0x4000",
          sizeBytes: 4096,
          permissions: { read: true, write: true, execute: false, private: true, shared: false },
          captured: { file: NATIVE_PROCESS_IMAGE_FILES.memory, offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate" },
        },
      ],
      refusals: emptyRefusals(),
    },
    threads: { formatVersion: 1, threads: [options.activeThread], refusals: emptyRefusals() },
    resources: {
      formatVersion: 1,
      resources:
        options.pollFd && options.pollFdResource !== "missing"
          ? [
              {
                id: `fd:${options.pollFd.fd}`,
                kind: options.pollFdResource?.kind ?? "pipe",
                state: "refused",
                fd: options.pollFd.fd,
                path: options.pollFdResource?.path ?? "pipe:[123]",
                flags: options.pollFdResource?.flags ?? ["octal:0"],
                recipe: options.pollFdResource?.recipe,
              },
            ]
          : [],
      refusals: emptyRefusals(),
    },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals: emptyRefusals(),
    },
  };
}

function documentsWithReadPipe(
  activeThread: NativeThreadState,
  options: {
    readFd?: number;
    writeFd?: number;
    readKind?: "pipe" | "file" | "socket" | "eventfd";
    readFlags?: string[];
    readRecipe?: Record<string, unknown>;
    includeWriteEnd?: boolean;
    writableBuffer?: boolean;
  } = {},
): NativeProcessImageDocuments {
  const documents = documentsWithTimespec({ activeThread });
  const readFd = options.readFd ?? 32;
  if (options.writableBuffer === false) {
    documents.mappings.mappings[0]!.permissions.write = false;
  }
  documents.resources.resources = [
    {
      id: `fd:${readFd}:read`,
      kind: options.readKind ?? "pipe",
      state: "refused",
      fd: readFd,
      path: options.readKind === "eventfd" ? "anon_inode:[eventfd]" : "pipe:[321]",
      flags: options.readFlags ?? ["octal:0"],
      recipe: options.readRecipe,
    },
    ...(options.includeWriteEnd === false
      ? []
      : [
          {
            id: `fd:${options.writeFd ?? 33}:write`,
            kind: "pipe" as const,
            state: "refused" as const,
            fd: options.writeFd ?? 33,
            path: "pipe:[321]",
            flags: ["octal:1"],
          },
        ]),
  ];
  return documents;
}

function documentsWithReadEventfd(
  activeThread: NativeThreadState,
  options: {
    readFd?: number;
    flags?: string[];
    recipe?: Record<string, unknown>;
    countBytes?: string;
  } = {},
): NativeProcessImageDocuments {
  if (options.countBytes) {
    activeThread.sourceRegisters = {
      ...activeThread.sourceRegisters,
      x:
        activeThread.sourceRegisters.arch === "arm64"
          ? ["0x22", "0x3100", options.countBytes, "0x0", "0x0", "0x0"]
          : [],
    } as NativeThreadState["sourceRegisters"];
  }
  return documentsWithReadPipe(activeThread, {
    readFd: options.readFd ?? 34,
    readKind: "eventfd",
    readFlags: options.flags ?? ["octal:2000002"],
    readRecipe: options.recipe ?? { eventfdCount: "0x0", eventfdSemaphore: 0 },
    includeWriteEnd: false,
  });
}

function documentsWithReadTimerfd(
  activeThread: NativeThreadState,
  options: { flags?: string[]; recipe?: Record<string, unknown> } = {},
): NativeProcessImageDocuments {
  const documents = documentsWithReadPipe(activeThread, {
    readFd: 36,
    readKind: "pipe",
    readFlags: options.flags ?? ["octal:2000002"],
    readRecipe: options.recipe ?? timerfdRecipe(),
    includeWriteEnd: false,
  });
  documents.resources.resources[0]!.kind = "timer";
  documents.resources.resources[0]!.path = "anon_inode:[timerfd]";
  return documents;
}

function documentsWithReadFile(
  activeThread: NativeThreadState,
  options: { flags?: string[]; recipe?: Record<string, unknown>; offset?: number } = {},
): NativeProcessImageDocuments {
  const documents = documentsWithReadPipe(activeThread, {
    readFd: 38,
    readKind: "file",
    readFlags: options.flags ?? ["octal:0"],
    readRecipe: options.recipe ?? {
      reopen: "/tmp/machinen-active-read.txt",
      offset: options.offset ?? 5,
    },
    includeWriteEnd: false,
  });
  documents.mappings.mappings[0]!.target.targetStart = "0x600000000000";
  documents.resources.resources[0]!.path = "/tmp/machinen-active-read.txt";
  documents.resources.resources[0]!.offset = options.offset ?? 5;
  return documents;
}

function documentsWithWriteFile(
  activeThread: NativeThreadState,
  options: {
    flags?: string[];
    recipe?: Record<string, unknown>;
    offset?: number;
    executable?: boolean;
  } = {},
): NativeProcessImageDocuments {
  const documents = documentsWithReadPipe(activeThread, {
    readFd: 39,
    readKind: "file",
    readFlags: options.flags ?? ["octal:1"],
    readRecipe: options.recipe ?? {
      reopen: "/tmp/machinen-active-write.txt",
      offset: options.offset ?? 7,
    },
    includeWriteEnd: false,
  });
  documents.mappings.mappings[0]!.target.targetStart = "0x600000000000";
  documents.mappings.mappings[0]!.permissions.execute = options.executable ?? false;
  documents.resources.resources[0]!.id = "fd:39:write";
  documents.resources.resources[0]!.path = "/tmp/machinen-active-write.txt";
  documents.resources.resources[0]!.offset = options.offset ?? 7;
  return documents;
}

function timerfdRecipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timerfdTicks: "0x0",
    timerfdSettimeFlags: 0,
    timerfdValueSeconds: 30,
    timerfdValueNanoseconds: 0,
    timerfdIntervalSeconds: 0,
    timerfdIntervalNanoseconds: 0,
    ...overrides,
  };
}

function documentsWithSocketResource(
  activeThread: NativeThreadState,
  options: { fd?: number; kind?: "socket" | "raw-socket" | "file" | "pipe" | "missing" } = {},
): NativeProcessImageDocuments {
  const documents = documentsWithTimespec({ activeThread });
  const fd = options.fd ?? 40;
  documents.resources.resources =
    options.kind === "missing"
      ? []
      : [
          {
            id: `fd:${fd}:socket`,
            kind: options.kind ?? "socket",
            state: "refused",
            fd,
            path: "socket:[4242]",
            flags: ["octal:2"],
          },
        ];
  return documents;
}

function documentsWithKernelFdResource(
  activeThread: NativeThreadState,
  fd: number,
  kind: "epoll" | "signalfd" | "file" | "missing",
): NativeProcessImageDocuments {
  const documents = documentsWithTimespec({ activeThread });
  documents.resources.resources =
    kind === "missing"
      ? []
      : [
          {
            id: `fd:${fd}:${kind}`,
            kind,
            state: "refused",
            fd,
            path: `anon_inode:[${kind}]`,
            flags: ["octal:0"],
          },
        ];
  return documents;
}

function emptyRefusals() {
  return { vocabularyVersion: 1 as const, refusals: [] };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native active syscall classification", () => {
  it("does not refuse threads outside syscalls", () => {
    const result = classifyNativeActiveSyscalls([thread({ state: "outside-syscall" })]);

    expect(result.refusals).toEqual([]);
    expect(result.classifications[0]).toMatchObject({
      class: "outside-syscall",
      resumable: false,
    });
  });

  it("classifies sleep/timer syscalls precisely", () => {
    const result = classifyNativeActiveSyscalls([
      thread({ state: "inside-syscall", number: 115, name: "clock_nanosleep" }),
    ]);

    expect(result.classifications[0]).toMatchObject({
      class: "sleep-timer",
      syscallName: "clock_nanosleep",
      refusal: { code: "blocking-syscall-state-unsupported" },
    });
    expect(result.refusals[0]?.detail).toMatchObject({ syscallClass: "sleep-timer" });
  });

  it("refuses deferred sleep/timer syscalls when remaining time is not modeled", () => {
    const result = classifyNativeActiveSyscalls(
      [thread({ state: "inside-syscall", number: 115, name: "clock_nanosleep" })],
      { sleepTimerPolicy: "defer-target-resume" },
    );

    expect(result.continuations).toEqual([]);
    expect(result.refusals[0]).toMatchObject({
      code: "target-sleep-remaining-time-missing",
      detail: { reason: "syscall arguments were not captured" },
    });
  });

  it("models relative clock_nanosleep remaining time from captured syscall timespec", () => {
    const activeThread = arm64SleepThread();
    const documents = documentsWithTimespec({ activeThread, seconds: 30n, nanoseconds: 456n });
    const result = classifyNativeActiveSyscalls([activeThread], {
      sleepTimerPolicy: "defer-target-resume",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "sleep-timer",
      action: "defer-target-resume",
      metadata: {
        remainingTime: {
          state: "modeled",
          kind: "relative-duration",
          seconds: "30",
          nanoseconds: 456,
          precision: "requested-duration-upper-bound",
        },
        sleepTimer: {
          syscallName: "clock_nanosleep",
          argumentSource: "registers",
          clockId: 0,
          flags: 0,
          requestPointer: "0x3000",
        },
        policy: "conservative-target-timer-rearm-required",
      },
    });
    expect(result.classifications[0]).toMatchObject({
      class: "sleep-timer",
      resumable: false,
    });
  });

  it("prefers /proc syscall arguments when capture recorded them", () => {
    const activeThread = arm64SleepThread({
      state: "inside-syscall",
      number: 115,
      name: "clock_nanosleep",
      arguments: ["0x0", "0x0", "0x3000", "0x0", "0x0", "0x0"],
    });
    const documents = documentsWithTimespec({ activeThread });

    expect(modelNativeSleepTimerState(activeThread, documents)).toMatchObject({
      state: "modeled",
      timer: { argumentSource: "proc-syscall", requestPointer: "0x3000" },
    });
  });

  it("models nanosleep request timespec arguments", () => {
    const activeThread = arm64SleepThread(
      { state: "inside-syscall", number: 101, name: "nanosleep" },
      ["0x3000", "0x0", "0x0", "0x0", "0x0", "0x0"],
    );
    const documents = documentsWithTimespec({ activeThread, seconds: 2n, nanoseconds: 10n });

    expect(modelNativeSleepTimerState(activeThread, documents)).toMatchObject({
      state: "modeled",
      timer: {
        syscallName: "nanosleep",
        requestPointer: "0x3000",
        remainingTime: { seconds: "2", nanoseconds: 10 },
      },
    });
  });

  it("fails closed for absolute clock_nanosleep until clock domains are modeled", () => {
    const activeThread = arm64SleepThread(
      { state: "inside-syscall", number: 115, name: "clock_nanosleep" },
      ["0x0", "0x1", "0x3000", "0x0", "0x0", "0x0"],
    );
    const documents = documentsWithTimespec({ activeThread });

    expect(modelNativeSleepTimerState(activeThread, documents)).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-sleep-remaining-time-missing",
        detail: { reason: "absolute clock_nanosleep deadlines are not modeled yet" },
      },
    });
  });

  it("models zero-fd ppoll timeout state from captured syscall timespec", () => {
    const activeThread = arm64PpollThread();
    const documents = documentsWithTimespec({ activeThread, seconds: 1n, nanoseconds: 250n });
    const result = classifyNativeActiveSyscalls([activeThread], {
      pollTimeoutPolicy: "defer-target-resume",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "poll-timeout",
      action: "defer-target-resume",
      metadata: {
        remainingTime: {
          state: "modeled",
          kind: "relative-duration",
          source: "active-syscall-ppoll-timeout",
          seconds: "1",
          nanoseconds: 250,
        },
        ppollTimeout: {
          syscallName: "ppoll",
          fdsPointer: "0x0",
          nfds: 0,
          timeoutPointer: "0x3000",
          sigmaskPointer: "0x0",
        },
        policy: "conservative-target-ppoll-timeout-rearm-required",
      },
    });
    expect(result.classifications[0]).toMatchObject({
      class: "poll-timeout",
      resumable: false,
    });
  });

  it("models one synthetic empty-pipe ppoll fd from captured pollfd memory", () => {
    const activeThread = arm64PpollThread(undefined, [
      "0x3100",
      "0x1",
      "0x3000",
      "0x0",
      "0x0",
      "0x0",
    ]);
    const documents = documentsWithTimespec({
      activeThread,
      seconds: 1n,
      nanoseconds: 250n,
      pollFd: { fd: 3, events: 1, revents: 0 },
    });
    const result = classifyNativeActiveSyscalls([activeThread], {
      pollTimeoutPolicy: "defer-target-resume",
      pollTimeoutFdPolicy: "synthetic-empty-pipe",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "poll-timeout",
      metadata: {
        ppollTimeout: {
          fdsPointer: "0x3100",
          nfds: 1,
          pollFds: [
            {
              fd: 3,
              events: 1,
              revents: 0,
              sourceAddress: "0x3100",
              resourceId: "fd:3",
              targetResource: "synthetic-empty-pipe-read-end",
            },
          ],
        },
      },
    });
  });

  it("models one synthetic empty-eventfd ppoll fd from captured pollfd memory", () => {
    const activeThread = arm64PpollThread(undefined, [
      "0x3100",
      "0x1",
      "0x3000",
      "0x0",
      "0x0",
      "0x0",
    ]);
    const documents = documentsWithTimespec({
      activeThread,
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "eventfd",
        path: "anon_inode:[eventfd]",
        flags: ["octal:2000002"],
        recipe: { eventfdCount: "0x0", eventfdSemaphore: 0 },
      },
    });
    const result = classifyNativeActiveSyscalls([activeThread], {
      pollTimeoutPolicy: "defer-target-resume",
      pollTimeoutFdPolicy: "synthetic-empty-eventfd",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "poll-timeout",
      metadata: {
        ppollTimeout: {
          nfds: 1,
          pollFds: [
            {
              fd: 3,
              resourceId: "fd:3",
              targetResource: "synthetic-empty-eventfd",
            },
          ],
        },
      },
    });
  });

  it("models one synthetic timerfd ppoll fd from captured pollfd memory", () => {
    const activeThread = arm64PpollThread(undefined, [
      "0x3100",
      "0x1",
      "0x3000",
      "0x0",
      "0x0",
      "0x0",
    ]);
    const documents = documentsWithTimespec({
      activeThread,
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "timer",
        path: "anon_inode:[timerfd]",
        flags: ["octal:2000002"],
        recipe: {
          timerfdTicks: "0x0",
          timerfdSettimeFlags: 0,
          timerfdIntervalSeconds: 0,
          timerfdIntervalNanoseconds: 0,
        },
      },
    });
    const result = classifyNativeActiveSyscalls([activeThread], {
      pollTimeoutPolicy: "defer-target-resume",
      pollTimeoutFdPolicy: "synthetic-timerfd",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "poll-timeout",
      metadata: {
        ppollTimeout: {
          nfds: 1,
          pollFds: [
            {
              fd: 3,
              resourceId: "fd:3",
              targetResource: "synthetic-timerfd",
            },
          ],
        },
      },
    });
  });

  it.each([
    {
      name: "missing fd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: "missing" as const,
      reason: "ppoll one-fd proof requires a captured pipe fd",
    },
    {
      name: "non-pipe fd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: { kind: "file" as const, path: "/tmp/input" },
      reason: "ppoll one-fd proof requires a captured pipe fd",
    },
    {
      name: "write-end pipe fd",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: { kind: "pipe" as const, flags: ["octal:1"] },
      reason: "ppoll one-fd proof requires a pipe read end",
    },
    {
      name: "wrong events",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 4, revents: 0 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "non-empty revents",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 1 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "nfds greater than one",
      x: ["0x3100", "0x2", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll synthetic empty-pipe proof supports exactly one fd",
    },
    {
      name: "non-null signal mask",
      x: ["0x3100", "0x1", "0x3000", "0x4000", "0x8", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll signal masks are not modeled yet",
    },
  ])("refuses one-fd ppoll unsafe state: $name", (scenario) => {
    const activeThread = arm64PpollThread(undefined, scenario.x);
    const documents = documentsWithTimespec({
      activeThread,
      pollFd: scenario.pollFd,
      pollFdResource: scenario.pollFdResource,
    });

    expect(
      modelNativePpollTimeoutState(activeThread, documents, "synthetic-empty-pipe"),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-ppoll-timeout-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "missing eventfd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: "missing" as const,
      reason: "ppoll one-fd proof requires a captured eventfd fd",
    },
    {
      name: "non-eventfd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: { kind: "pipe" as const, flags: ["octal:0"] },
      reason: "ppoll one-fd proof requires a captured eventfd fd",
    },
    {
      name: "non-zero counter",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "eventfd" as const,
        flags: ["octal:2000002"],
        recipe: { eventfdCount: "0x1", eventfdSemaphore: 0 },
      },
      reason: "ppoll one-fd eventfd proof requires an empty eventfd",
    },
    {
      name: "semaphore mode",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "eventfd" as const,
        flags: ["octal:2000002"],
        recipe: { eventfdCount: "0x0", eventfdSemaphore: 1 },
      },
      reason: "ppoll one-fd eventfd proof does not model semaphore mode",
    },
    {
      name: "unsupported fd access flags",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "eventfd" as const,
        flags: ["octal:2000000"],
        recipe: { eventfdCount: "0x0", eventfdSemaphore: 0 },
      },
      reason: "ppoll one-fd eventfd proof requires read/write access",
    },
    {
      name: "unsupported extra fd flags",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "eventfd" as const,
        flags: ["octal:2004002"],
        recipe: { eventfdCount: "0x0", eventfdSemaphore: 0 },
      },
      reason: "ppoll one-fd eventfd proof requires supported flags",
    },
    {
      name: "wrong events",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 4, revents: 0 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "non-empty revents",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 1 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "nfds greater than one",
      x: ["0x3100", "0x2", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll synthetic empty-eventfd proof supports exactly one fd",
    },
    {
      name: "non-null signal mask",
      x: ["0x3100", "0x1", "0x3000", "0x4000", "0x8", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll signal masks are not modeled yet",
    },
  ])("refuses one-fd eventfd ppoll unsafe state: $name", (scenario) => {
    const activeThread = arm64PpollThread(undefined, scenario.x);
    const documents = documentsWithTimespec({
      activeThread,
      pollFd: scenario.pollFd,
      pollFdResource: scenario.pollFdResource ?? {
        kind: "eventfd",
        flags: ["octal:2000002"],
        recipe: { eventfdCount: "0x0", eventfdSemaphore: 0 },
      },
    });

    expect(
      modelNativePpollTimeoutState(activeThread, documents, "synthetic-empty-eventfd"),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-ppoll-timeout-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "missing timerfd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: "missing" as const,
      reason: "ppoll one-fd timerfd proof requires a captured timerfd fd",
    },
    {
      name: "non-timerfd resource",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: { kind: "eventfd" as const, flags: ["octal:2000002"] },
      reason: "ppoll one-fd timerfd proof requires a captured timerfd fd",
    },
    {
      name: "expired/readable timer",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "timer" as const,
        flags: ["octal:2000002"],
        recipe: {
          timerfdTicks: "0x1",
          timerfdSettimeFlags: 0,
          timerfdIntervalSeconds: 0,
          timerfdIntervalNanoseconds: 0,
        },
      },
      reason: "ppoll one-fd timerfd proof requires an unread timer",
    },
    {
      name: "periodic timer",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "timer" as const,
        flags: ["octal:2000002"],
        recipe: {
          timerfdTicks: "0x0",
          timerfdSettimeFlags: 0,
          timerfdIntervalSeconds: 1,
          timerfdIntervalNanoseconds: 0,
        },
      },
      reason: "ppoll one-fd timerfd proof does not model periodic timers",
    },
    {
      name: "unsupported flags",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      pollFdResource: {
        kind: "timer" as const,
        flags: ["octal:2004002"],
        recipe: {
          timerfdTicks: "0x0",
          timerfdSettimeFlags: 0,
          timerfdIntervalSeconds: 0,
          timerfdIntervalNanoseconds: 0,
        },
      },
      reason: "ppoll one-fd timerfd proof requires supported flags",
    },
    {
      name: "wrong events",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 4, revents: 0 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "non-empty revents",
      x: ["0x3100", "0x1", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 1 },
      reason: "ppoll one-fd proof only models POLLIN with empty revents",
    },
    {
      name: "nfds greater than one",
      x: ["0x3100", "0x2", "0x3000", "0x0", "0x0", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll synthetic timerfd proof supports exactly one fd",
    },
    {
      name: "non-null signal mask",
      x: ["0x3100", "0x1", "0x3000", "0x4000", "0x8", "0x0"],
      pollFd: { fd: 3, events: 1, revents: 0 },
      reason: "ppoll signal masks are not modeled yet",
    },
  ])("refuses one-fd timerfd ppoll unsafe state: $name", (scenario) => {
    const activeThread = arm64PpollThread(undefined, scenario.x);
    const documents = documentsWithTimespec({
      activeThread,
      pollFd: scenario.pollFd,
      pollFdResource: scenario.pollFdResource ?? {
        kind: "timer",
        flags: ["octal:2000002"],
        recipe: {
          timerfdTicks: "0x0",
          timerfdSettimeFlags: 0,
          timerfdIntervalSeconds: 0,
          timerfdIntervalNanoseconds: 0,
        },
      },
    });

    expect(
      modelNativePpollTimeoutState(activeThread, documents, "synthetic-timerfd"),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-ppoll-timeout-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it("refuses ppoll variants whose fd or signal-mask contracts are not modeled", () => {
    const withFds = arm64PpollThread(undefined, ["0x0", "0x1", "0x3000", "0x0", "0x0", "0x0"]);
    expect(
      modelNativePpollTimeoutState(withFds, documentsWithTimespec({ activeThread: withFds })),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-ppoll-timeout-missing",
        detail: { reason: "ppoll fd readiness is not modeled yet" },
      },
    });

    const withSigmask = arm64PpollThread(undefined, [
      "0x0",
      "0x0",
      "0x3000",
      "0x4000",
      "0x8",
      "0x0",
    ]);
    expect(
      modelNativePpollTimeoutState(
        withSigmask,
        documentsWithTimespec({ activeThread: withSigmask }),
      ),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-ppoll-timeout-missing",
        detail: { reason: "ppoll signal masks are not modeled yet" },
      },
    });
  });

  it("models a blocked read from an empty pipe with a paired write end", () => {
    const activeThread = arm64ReadThread();
    const documents = documentsWithReadPipe(activeThread);
    const result = classifyNativeActiveSyscalls([activeThread], {
      fdReadPolicy: "defer-target-resume",
      fdReadResourcePolicy: "synthetic-empty-pipe",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "fd-blocking",
      action: "defer-target-resume",
      metadata: {
        fdRead: {
          syscallName: "read",
          argumentSource: "registers",
          fd: 32,
          bufferPointer: "0x3100",
          countBytes: 1,
          bufferMapping: "mapping:stack",
          resourceId: "fd:32:read",
          pairedWriteResourceId: "fd:33:write",
          targetResource: "synthetic-empty-pipe-read-end",
        },
        policy: "conservative-target-fd-read-block-preserved",
      },
    });
    expect(result.classifications[0]).toMatchObject({ class: "fd-blocking", resumable: false });
  });

  it("models a blocked read from an empty eventfd", () => {
    const activeThread = arm64ReadThread(["0x22", "0x3100", "0x8", "0x0", "0x0", "0x0"]);
    const documents = documentsWithReadEventfd(activeThread);
    const result = classifyNativeActiveSyscalls([activeThread], {
      fdReadPolicy: "defer-target-resume",
      fdReadResourcePolicy: "synthetic-empty-eventfd",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "fd-blocking",
      metadata: {
        fdRead: {
          fd: 34,
          countBytes: 8,
          resourceId: "fd:34:read",
          targetResource: "synthetic-empty-eventfd",
        },
        policy: "conservative-target-fd-read-block-preserved",
      },
    });
  });

  it("models a blocked read from a timerfd with remaining time", () => {
    const activeThread = arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]);
    const documents = documentsWithReadTimerfd(activeThread);
    const result = classifyNativeActiveSyscalls([activeThread], {
      fdReadPolicy: "defer-target-resume",
      fdReadResourcePolicy: "synthetic-timerfd",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "fd-blocking",
      metadata: {
        fdRead: {
          fd: 36,
          countBytes: 8,
          resourceId: "fd:36:read",
          targetResource: "synthetic-timerfd",
          remainingTime: {
            state: "modeled",
            source: "active-syscall-timerfd-read-timeout",
            seconds: "30",
            nanoseconds: 0,
          },
        },
      },
    });
  });

  it("models a safe offset-backed read from a regular file", () => {
    const activeThread = arm64ReadThread(["0x26", "0x3100", "0x4", "0x0", "0x0", "0x0"]);
    const documents = documentsWithReadFile(activeThread, { offset: 7 });
    const result = classifyNativeActiveSyscalls([activeThread], {
      fdReadPolicy: "defer-target-resume",
      fdReadResourcePolicy: "reopen-file",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "fd-blocking",
      metadata: {
        fdRead: {
          fd: 38,
          countBytes: 4,
          resourceId: "fd:38:read",
          targetResource: "reopened-offset-file",
          targetBufferPointer: "0x600000000100",
          fileOffset: 7,
        },
        policy: "conservative-target-fd-read-block-preserved",
      },
    });
  });

  it("models a safe offset-backed write to a regular file", () => {
    const activeThread = arm64WriteThread(["0x27", "0x3100", "0x4", "0x0", "0x0", "0x0"]);
    const documents = documentsWithWriteFile(activeThread, { offset: 7 });
    const result = classifyNativeActiveSyscalls([activeThread], {
      fdWritePolicy: "defer-target-resume",
      fdWriteResourcePolicy: "reopen-file",
      documents,
    });

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "fd-blocking",
      metadata: {
        fdWrite: {
          fd: 39,
          countBytes: 4,
          resourceId: "fd:39:write",
          targetResource: "reopened-offset-file",
          targetBufferPointer: "0x600000000100",
          fileOffset: 7,
        },
        policy: "conservative-target-fd-write-completed-from-buffer",
      },
    });
  });

  it("prefers /proc syscall arguments for modeled read", () => {
    const activeThread = arm64ReadThread();
    activeThread.syscall.arguments = ["0x20", "0x3100", "0x1", "0x0", "0x0", "0x0"];
    const documents = documentsWithReadPipe(activeThread);

    expect(modelNativeFdReadState(activeThread, documents)).toMatchObject({
      state: "modeled",
      read: { argumentSource: "proc-syscall", fd: 32, countBytes: 1 },
    });
  });

  it.each([
    {
      name: "zero count",
      thread: arm64WriteThread(["0x27", "0x3100", "0x0", "0x0", "0x0", "0x0"]),
      reason: "write count is outside supported bounds",
    },
    {
      name: "null buffer",
      thread: arm64WriteThread(["0x27", "0x0", "0x4", "0x0", "0x0", "0x0"]),
      reason: "write buffer pointer is null",
    },
    {
      name: "executable buffer",
      thread: arm64WriteThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithWriteFile(thread, { executable: true }),
      reason: "write buffer is not in captured readable data memory",
    },
    {
      name: "read-only fd",
      thread: arm64WriteThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithWriteFile(thread, { flags: ["octal:0"] }),
      reason: "write file proof requires a writable file fd",
    },
    {
      name: "append fd",
      thread: arm64WriteThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithWriteFile(thread, { flags: ["octal:2001"] }),
      reason: "write file proof does not model O_APPEND",
    },
  ])("refuses unsafe file write state: $name", (scenario) => {
    const documents = scenario.documents
      ? scenario.documents(scenario.thread)
      : documentsWithWriteFile(scenario.thread);

    expect(modelNativeFdWriteState(scenario.thread, documents)).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-fd-write-state-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "zero count",
      thread: arm64ReadThread(["0x20", "0x3100", "0x0", "0x0", "0x0", "0x0"]),
      reason: "read count is outside supported bounds",
    },
    {
      name: "null buffer",
      thread: arm64ReadThread(["0x20", "0x0", "0x1", "0x0", "0x0", "0x0"]),
      reason: "read buffer pointer is null",
    },
    {
      name: "buffer not writable",
      thread: arm64ReadThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { writableBuffer: false }),
      reason: "read buffer is not in captured writable memory",
    },
    {
      name: "missing pipe resource",
      thread: arm64ReadThread(),
      documents: (thread: NativeThreadState) => documentsWithReadPipe(thread, { readKind: "file" }),
      reason: "read proof requires a captured pipe fd",
    },
    {
      name: "write-end fd",
      thread: arm64ReadThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { readFlags: ["octal:1"] }),
      reason: "read proof requires a pipe read end",
    },
    {
      name: "missing paired write end",
      thread: arm64ReadThread(),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { includeWriteEnd: false }),
      reason: "read proof requires a paired pipe write end to avoid EOF",
    },
  ])("refuses unsafe fd-read state: $name", (scenario) => {
    const documents = scenario.documents
      ? scenario.documents(scenario.thread)
      : documentsWithReadPipe(scenario.thread);

    expect(modelNativeFdReadState(scenario.thread, documents)).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-fd-read-state-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "non-file resource",
      thread: arm64ReadThread(["0x26", "0x3100", "0x4", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { readFd: 38, readKind: "pipe" }),
      reason: "read file proof requires a captured regular file fd",
    },
    {
      name: "write-only file",
      thread: arm64ReadThread(["0x26", "0x3100", "0x4", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadFile(thread, { flags: ["octal:1"] }),
      reason: "read file proof requires a readable file fd",
    },
    {
      name: "missing reopen recipe",
      thread: arm64ReadThread(["0x26", "0x3100", "0x4", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) => documentsWithReadFile(thread, { recipe: {} }),
      reason: "read file proof requires a reopen recipe",
    },
  ])("refuses unsafe regular-file read state: $name", (scenario) => {
    expect(
      modelNativeFdReadState(scenario.thread, scenario.documents(scenario.thread), "reopen-file"),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-fd-read-state-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "short eventfd read",
      thread: arm64ReadThread(["0x22", "0x3100", "0x4", "0x0", "0x0", "0x0"]),
      reason: "read eventfd proof requires count >= 8",
    },
    {
      name: "non-eventfd resource",
      thread: arm64ReadThread(["0x22", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { readFd: 34, readKind: "pipe" }),
      reason: "read proof requires a captured eventfd fd",
    },
    {
      name: "non-empty counter",
      thread: arm64ReadThread(["0x22", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadEventfd(thread, { recipe: { eventfdCount: "0x1", eventfdSemaphore: 0 } }),
      reason: "read eventfd proof requires an empty eventfd",
    },
    {
      name: "semaphore mode",
      thread: arm64ReadThread(["0x22", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadEventfd(thread, { recipe: { eventfdCount: "0x0", eventfdSemaphore: 1 } }),
      reason: "read eventfd proof does not model semaphore mode",
    },
    {
      name: "unsupported flags",
      thread: arm64ReadThread(["0x22", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadEventfd(thread, { flags: ["octal:2004002"] }),
      reason: "read eventfd proof requires supported flags",
    },
  ])("refuses unsafe eventfd read state: $name", (scenario) => {
    const documents = scenario.documents
      ? scenario.documents(scenario.thread)
      : documentsWithReadEventfd(scenario.thread);

    expect(
      modelNativeFdReadState(scenario.thread, documents, "synthetic-empty-eventfd"),
    ).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-fd-read-state-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it.each([
    {
      name: "short timerfd read",
      thread: arm64ReadThread(["0x24", "0x3100", "0x4", "0x0", "0x0", "0x0"]),
      reason: "read timerfd proof requires count >= 8",
    },
    {
      name: "non-timerfd resource",
      thread: arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadPipe(thread, { readFd: 36, readKind: "pipe" }),
      reason: "read proof requires a captured timerfd fd",
    },
    {
      name: "expired readable timer",
      thread: arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadTimerfd(thread, { recipe: timerfdRecipe({ timerfdTicks: "0x1" }) }),
      reason: "read timerfd proof requires an unread timer",
    },
    {
      name: "periodic timer",
      thread: arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadTimerfd(thread, { recipe: timerfdRecipe({ timerfdIntervalSeconds: 1 }) }),
      reason: "read timerfd proof does not model periodic timers",
    },
    {
      name: "absolute timer",
      thread: arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadTimerfd(thread, { recipe: timerfdRecipe({ timerfdSettimeFlags: 1 }) }),
      reason: "read timerfd proof does not model absolute timers",
    },
    {
      name: "unsupported flags",
      thread: arm64ReadThread(["0x24", "0x3100", "0x8", "0x0", "0x0", "0x0"]),
      documents: (thread: NativeThreadState) =>
        documentsWithReadTimerfd(thread, { flags: ["octal:2004002"] }),
      reason: "read timerfd proof requires supported flags",
    },
  ])("refuses unsafe timerfd read state: $name", (scenario) => {
    const documents = scenario.documents
      ? scenario.documents(scenario.thread)
      : documentsWithReadTimerfd(scenario.thread);

    expect(modelNativeFdReadState(scenario.thread, documents, "synthetic-timerfd")).toMatchObject({
      state: "missing",
      refusal: {
        code: "target-fd-read-state-missing",
        detail: { reason: scenario.reason },
      },
    });
  });

  it("refuses active futex wait with futex-specific detail", () => {
    const activeThread = arm64FutexThread("futex", [
      "0x5000",
      "0x80",
      "0x1",
      "0x6000",
      "0x0",
      "0x0",
    ]);
    const result = classifyNativeActiveSyscalls([activeThread]);

    expect(result.classifications[0]).toMatchObject({
      class: "futex-wait",
      refusal: {
        code: "futex-state-unsupported",
        detail: {
          reason: "futex waiter kernel queue state is unsupported",
          futexSyscall: {
            name: "futex",
            arguments: { source: "registers", uaddr: "0x5000", operation: "0x80" },
            unsupportedState: expect.arrayContaining(["kernel wait queue membership"]),
          },
        },
      },
    });
  });

  it("refuses futex_waitv with vector-wait argument detail", () => {
    const activeThread = arm64FutexThread("futex_waitv", [
      "0x5100",
      "0x2",
      "0x0",
      "0x6200",
      "0x0",
      "0x0",
    ]);
    const result = classifyNativeActiveSyscalls([activeThread]);

    expect(result.classifications[0]).toMatchObject({
      class: "futex-wait",
      refusal: {
        code: "futex-state-unsupported",
        detail: {
          futexSyscall: {
            name: "futex_waitv",
            arguments: { source: "registers", waitersPointer: "0x5100", waiterCount: "0x2" },
          },
        },
      },
    });
  });

  it("refuses active epoll wait with epoll-specific detail", () => {
    const activeThread = arm64EpollThread("epoll_pwait", [
      "0x30",
      "0x4100",
      "0x4",
      "0xffffffff",
      "0x0",
      "0x8",
    ]);
    const result = classifyNativeActiveSyscalls([activeThread], {
      documents: documentsWithKernelFdResource(activeThread, 48, "epoll"),
    });

    expect(result.classifications[0]).toMatchObject({
      class: "fd-blocking",
      refusal: {
        code: "target-epoll-syscall-state-unsupported",
        detail: {
          reason: "epoll kernel ready list state is unsupported",
          epollSyscall: {
            arguments: { source: "registers", epfd: 48, eventsPointer: "0x4100" },
            resource: { id: "fd:48:epoll", kind: "epoll", fd: 48 },
          },
        },
      },
    });
  });

  it("refuses signalfd reads with signal-queue-specific detail", () => {
    const activeThread = arm64ReadThread(["0x32", "0x4100", "0x80", "0x0", "0x0", "0x0"]);
    const result = classifyNativeActiveSyscalls([activeThread], {
      documents: documentsWithKernelFdResource(activeThread, 50, "signalfd"),
      fdReadPolicy: "defer-target-resume",
    });

    expect(result.classifications[0]).toMatchObject({
      class: "fd-blocking",
      refusal: {
        code: "target-signalfd-state-unsupported",
        detail: {
          reason: "signalfd pending signal queue state is unsupported",
          signalfdRead: {
            arguments: { source: "registers", fd: 50, bufferPointer: "0x4100" },
            resource: { id: "fd:50:signalfd", kind: "signalfd", fd: 50 },
          },
        },
      },
    });
  });

  it.each(["accept", "accept4", "connect"] as const)(
    "refuses active socket syscall %s with socket-specific detail",
    (name) => {
      const activeThread = arm64SocketThread(name, [
        "0x28",
        "0x4100",
        "0x4200",
        "0x800",
        "0x0",
        "0x0",
      ]);
      const result = classifyNativeActiveSyscalls([activeThread], {
        documents: documentsWithSocketResource(activeThread),
      });

      expect(result.classifications[0]).toMatchObject({
        class: "fd-blocking",
        refusal: {
          code: "target-socket-syscall-state-unsupported",
          detail: {
            reason: "socket endpoint kernel state is unsupported",
            socketSyscall: {
              family: "socket-accept-connect",
              arguments: { source: "registers", fd: 40 },
              resource: { id: "fd:40:socket", kind: "socket", fd: 40 },
            },
          },
        },
      });
    },
  );

  it.each([
    {
      name: "missing epoll resource",
      thread: arm64EpollThread(),
      documents: (activeThread: NativeThreadState) =>
        documentsWithKernelFdResource(activeThread, 48, "missing"),
      reason: "epoll fd resource is missing",
      code: "target-epoll-syscall-state-unsupported",
    },
    {
      name: "non-epoll fd",
      thread: arm64EpollThread(),
      documents: (activeThread: NativeThreadState) =>
        documentsWithKernelFdResource(activeThread, 48, "file"),
      reason: "epoll fd is not a captured epoll instance",
      code: "target-epoll-syscall-state-unsupported",
    },
  ])("keeps active epoll syscall fail-closed for $name", (scenario) => {
    const result = classifyNativeActiveSyscalls([scenario.thread], {
      documents: scenario.documents(scenario.thread),
    });

    expect(result.classifications[0]).toMatchObject({
      class: "fd-blocking",
      refusal: { code: scenario.code, detail: { reason: scenario.reason } },
    });
  });

  it.each([
    {
      name: "missing args",
      thread: thread({ state: "inside-syscall", number: 203, name: "connect" }),
      documents: undefined,
      reason: "socket syscall arguments were not captured",
    },
    {
      name: "missing resource",
      thread: arm64SocketThread("connect"),
      documents: (activeThread: NativeThreadState) =>
        documentsWithSocketResource(activeThread, { kind: "missing" }),
      reason: "socket syscall fd resource is missing",
    },
    {
      name: "non-socket fd",
      thread: arm64SocketThread("accept"),
      documents: (activeThread: NativeThreadState) =>
        documentsWithSocketResource(activeThread, { kind: "file" }),
      reason: "socket syscall fd is not a captured socket",
    },
  ])("keeps active socket syscall fail-closed for $name", (scenario) => {
    const documents = scenario.documents ? scenario.documents(scenario.thread) : undefined;
    const result = classifyNativeActiveSyscalls([scenario.thread], { documents });

    expect(result.classifications[0]).toMatchObject({
      class: "fd-blocking",
      refusal: {
        code: "target-socket-syscall-state-unsupported",
        detail: { reason: scenario.reason },
      },
    });
  });

  it("classifies fd-blocking syscalls separately from sleep timers", () => {
    const result = classifyNativeActiveSyscalls([
      thread({ state: "inside-syscall", number: 63, name: "read" }),
    ]);

    expect(result.classifications[0]).toMatchObject({
      class: "fd-blocking",
      refusal: { code: "blocking-syscall-state-unsupported" },
    });
  });

  it("classifies restart state with a restart-specific code", () => {
    const result = classifyNativeActiveSyscalls([
      thread({ state: "restart-block", number: 128, name: "restart_syscall" }),
    ]);

    expect(result.classifications[0]).toMatchObject({
      class: "restart",
      refusal: { code: "syscall-restart-unsupported" },
    });
  });

  it("keeps unknown active syscalls fail-closed", () => {
    const result = classifyNativeActiveSyscalls([
      thread({ state: "inside-syscall", number: 9999, name: "unknown" }),
    ]);

    expect(result.classifications[0]).toMatchObject({
      class: "unknown-active",
      refusal: { code: "active-syscall" },
    });
  });
});
