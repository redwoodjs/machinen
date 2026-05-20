import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const HELPER = join(REPO_ROOT, "scripts/portable-proof-compare.mjs");
const TMP: string[] = [];
const EXPECTED_HEAP_BYTES = [
  0x4d, 0x61, 0x63, 0x68, 0x69, 0x6e, 0x65, 0x6e, 0x2d, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x21, 0x00,
];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function marker(
  phase: string,
  counter: number,
  arch = "amd64",
  opts: { threads?: boolean; nested?: boolean } = {},
): string {
  return (
    "MACHINEN_PORTABLE_PROOF " +
    JSON.stringify({
      schema_version: 1,
      phase,
      arch,
      counter,
      list: [1, 2, 3],
      checkpoint_abi_version: 1,
      checkpoint_symbol: "machinen_checkpoint",
      checkpoint_continuation: opts.nested
        ? "machinen_portable_nested_checkpoint"
        : "machinen_portable_checkpoint",
      restore_symbol: "machinen_restore_main",
      restore_continuation: opts.nested
        ? "machinen_portable_nested_restore_entry"
        : "machinen_portable_restore_entry",
      state_symbol: "machinen_portable_app_state",
      root_count: 3,
      root_names: [
        "machinen_portable_app_state",
        "machinen_portable_nodes",
        "machinen_portable_heap_bytes",
      ],
      thread_count: opts.threads ? 2 : 1,
      thread_continuations: [
        opts.nested ? "machinen_portable_nested_checkpoint" : "machinen_portable_checkpoint",
        "machinen_portable_worker_continue",
      ],
      nested_continuation: opts.nested === true,
      nested_live_value: opts.nested ? 4242 : 0,
      allocation_count: 1,
      heap_bytes: EXPECTED_HEAP_BYTES,
      checkpoint_result: 0,
      safe_point: {
        outside_signal_handler: true,
        outside_syscall: true,
      },
    }) +
    "\n"
  );
}

function writeLog(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-proof-log-"));
  TMP.push(dir);
  const path = join(dir, "proof.log");
  writeFileSync(path, contents);
  return path;
}

function writeBundle(heapBytes = EXPECTED_HEAP_BYTES): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-proof-bundle-"));
  TMP.push(dir);
  mkdirSync(join(dir, "logs"));
  const memory = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(heapBytes)]);
  writeFileSync(join(dir, "memory.bin"), memory);
  writeFileSync(join(dir, "relocations.json"), JSON.stringify(tinyRelocations()));
  writeFileSync(join(dir, "resources.json"), JSON.stringify(tinyResources()));
  writeFileSync(
    join(dir, "objects.json"),
    JSON.stringify({
      formatVersion: 1,
      objects: [
        { id: "global-app-state", kind: "global", memory: { offset: 0, sizeBytes: 2 } },
        { id: "global-nodes", kind: "global", memory: { offset: 2, sizeBytes: 2 } },
        {
          id: "heap-1",
          kind: "heap",
          allocation: { id: 1, sourceAddress: "0x1234" },
          memory: { offset: 4, sizeBytes: EXPECTED_HEAP_BYTES.length },
        },
      ],
      unsupported: { vocabularyVersion: 1, refusals: [] },
    }),
  );
  return dir;
}

function writeThreadsBundle(): string {
  const dir = writeBundle();
  writeFileSync(
    join(dir, "threads.json"),
    JSON.stringify({
      formatVersion: 1,
      barrier: { name: "portable-proof-checkpoint", participants: 2, state: "complete" },
      threads: [
        {
          id: 0,
          name: "main",
          continuation: "machinen_portable_checkpoint",
          localState: { counter: 1000, atBarrier: true },
        },
        {
          id: 1,
          name: "worker",
          continuation: "machinen_portable_worker_continue",
          localState: { counter: 2001, atBarrier: true },
        },
      ],
      unsupported: { vocabularyVersion: 1, refusals: [] },
    }),
  );
  return dir;
}

function tinyResources() {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: ["portable-proof"] },
      { id: "env", kind: "env", state: "captured", env: {} },
      { id: "cwd", kind: "cwd", state: "captured", path: "/" },
      {
        id: "file-1",
        kind: "file",
        state: "captured",
        path: "/tmp/proof-resource.txt",
        fd: 3,
        flags: ["read"],
        offset: 4,
      },
    ],
    unsupported: { vocabularyVersion: 1, refusals: [] },
  };
}

function tinyRelocations() {
  return {
    formatVersion: 1,
    relocations: [
      {
        fromObject: "global-app-state",
        fromOffset: 8,
        toObject: "global-nodes",
        addend: 0,
        kind: "pointer",
        sourcePointer: "0x1000",
      },
      {
        fromObject: "global-nodes",
        fromOffset: 8,
        toObject: "global-nodes",
        addend: 16,
        kind: "pointer",
        sourcePointer: "0x1010",
      },
      {
        fromObject: "global-nodes",
        fromOffset: 24,
        toObject: "global-nodes",
        addend: 32,
        kind: "pointer",
        sourcePointer: "0x1020",
      },
    ],
    unsupported: { vocabularyVersion: 1, refusals: [] },
  };
}

function runHelper(args: string[], input?: string) {
  return spawnSync(process.execPath, [HELPER, ...args], { encoding: "utf8", input });
}

describe("portable proof workload helper", () => {
  it("accepts deterministic checkpoint/restore/continue markers", () => {
    const log = writeLog(
      marker("checkpoint", 1000) + marker("restore", 1000) + marker("continue", 1001),
    );
    const res = runHelper([
      "--expect-arch",
      "amd64",
      "--require-restore",
      "--require-continue",
      log,
    ]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, events: 3 });
  });

  it("accepts stdin when the path is '-'", () => {
    const res = runHelper(
      ["--expect-arch", "amd64", "--require-restore", "--require-continue", "-"],
      marker("checkpoint", 1000) + marker("restore", 1000) + marker("continue", 1001),
    );
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, events: 3 });
  });

  it("validates captured heap bytes in a proof bundle", () => {
    const log = writeLog(marker("checkpoint", 1000));
    const bundle = writeBundle();
    const res = runHelper(["--bundle-dir", bundle, log]);
    expect(res.status).toBe(0);
  });

  it("validates cooperative thread metadata when requested", () => {
    const log = writeLog(marker("checkpoint", 1000, "amd64", { threads: true }));
    const bundle = writeThreadsBundle();
    const res = runHelper(["--bundle-dir", bundle, "--require-threads", log]);
    expect(res.status).toBe(0);
  });

  it("rejects a missing two-thread proof marker when requested", () => {
    const log = writeLog(marker("checkpoint", 1000));
    const res = runHelper(["--require-threads", log]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/missing two-thread proof marker/);
  });

  it("validates nested continuation markers when requested", () => {
    const log = writeLog(marker("checkpoint", 1000, "amd64", { nested: true }));
    const res = runHelper(["--require-nested-continuation", log]);
    expect(res.status).toBe(0);
  });

  it("rejects a missing nested continuation marker when requested", () => {
    const log = writeLog(marker("checkpoint", 1000));
    const res = runHelper(["--require-nested-continuation", log]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/missing nested continuation proof marker/);
  });

  it("rejects a proof bundle whose captured heap bytes changed", () => {
    const log = writeLog(marker("checkpoint", 1000));
    const bundle = writeBundle([0, ...EXPECTED_HEAP_BYTES.slice(1)]);
    const res = runHelper(["--bundle-dir", bundle, log]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/heap-1 bytes expected/);
  });

  it("rejects a restore marker whose state differs from the checkpoint", () => {
    const badRestore =
      "MACHINEN_PORTABLE_PROOF " +
      JSON.stringify({
        schema_version: 1,
        phase: "restore",
        arch: "amd64",
        counter: 999,
        list: [1, 2, 3],
        checkpoint_abi_version: 1,
        checkpoint_symbol: "machinen_checkpoint",
        checkpoint_continuation: "machinen_portable_checkpoint",
        restore_symbol: "machinen_restore_main",
        restore_continuation: "machinen_portable_restore_entry",
        state_symbol: "machinen_portable_app_state",
        root_count: 3,
        root_names: [
          "machinen_portable_app_state",
          "machinen_portable_nodes",
          "machinen_portable_heap_bytes",
        ],
        allocation_count: 1,
        heap_bytes: EXPECTED_HEAP_BYTES,
        checkpoint_result: 0,
        safe_point: {
          outside_signal_handler: true,
          outside_syscall: true,
        },
      }) +
      "\n";
    const log = writeLog(marker("checkpoint", 1000) + badRestore);
    const res = runHelper(["--require-restore", log]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/restore\.counter expected 1000/);
  });
});
