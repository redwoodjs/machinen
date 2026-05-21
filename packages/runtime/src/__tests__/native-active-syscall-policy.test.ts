import { describe, expect, it } from "vitest";

import { classifyNativeActiveSyscalls } from "../native-active-syscall-policy.ts";
import type { NativeThreadState } from "../native-process-image.ts";

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

  it("can explicitly defer sleep/timer syscalls without marking them directly resumable", () => {
    const result = classifyNativeActiveSyscalls(
      [thread({ state: "inside-syscall", number: 115, name: "clock_nanosleep" })],
      { sleepTimerPolicy: "defer-target-resume" },
    );

    expect(result.refusals).toEqual([]);
    expect(result.continuations[0]).toMatchObject({
      syscallClass: "sleep-timer",
      action: "defer-target-resume",
      metadata: {
        remainingTime: "not-captured",
        policy: "conservative-target-timer-rearm-required",
      },
    });
    expect(result.classifications[0]).toMatchObject({
      class: "sleep-timer",
      resumable: false,
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
