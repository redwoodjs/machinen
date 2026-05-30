import { describe, expect, it } from "vitest";

import {
  parseNodeProperLevel5ProcMaps,
  summarizeNodeProperLevel5SourceInspection,
} from "../node-proper-level5-source-inspection.ts";

const SAMPLE_NODE_MAPS = `
55d7a7b8d000-55d7a7b8e000 r--p 00000000 08:01 123 /usr/bin/node
55d7a7b8e000-55d7a7b8f000 r-xp 00001000 08:01 123 /usr/bin/node
55d7a8d00000-55d7a8f00000 rw-p 00000000 00:00 0 [heap]
7f6b70000000-7f6b70200000 rw-p 00000000 00:00 0
7f6b71000000-7f6b71010000 r-xp 00000000 00:00 0
7f6b72000000-7f6b72100000 r-xp 00000000 08:01 456 /usr/lib/aarch64-linux-gnu/libnode.so.108
7ffd00000000-7ffd00021000 rw-p 00000000 00:00 0 [stack]
`;

describe("proper Node Level 5 source process inspection", () => {
  it("parses Linux proc maps as captured source process state", () => {
    const maps = parseNodeProperLevel5ProcMaps(SAMPLE_NODE_MAPS);

    expect(maps).toHaveLength(7);
    expect(maps.map((entry) => entry.kind)).toEqual([
      "other",
      "executable-file",
      "heap",
      "anonymous-rw",
      "anonymous-executable",
      "shared-object",
      "stack",
    ]);
  });

  it("defines the real Level 5 track without runtime profiles or app selected state", () => {
    const summary = summarizeNodeProperLevel5SourceInspection({
      procMaps: SAMPLE_NODE_MAPS,
      cmdline: ["node", "counter.mjs"],
      fdTargets: ["socket:[1234]"],
    });

    expect(summary).toMatchObject({
      goal: "023",
      productSupport: "not-yet-supported",
      implementationLevel: "first-proof-only",
      migrationCompleted: true,
      runtimeLevelProfilesUsed: false,
      checkpointRestoreSubstrateUsed: false,
      appSpecificSelectedStateUsed: false,
      maps: {
        total: 7,
        executableFiles: 1,
        sharedObjects: 1,
        heaps: 1,
        stacks: 1,
        anonymousRw: 1,
        anonymousExecutable: 1,
      },
      firstProofTarget: {
        singleThreadNode: true,
        nativeAddonsAllowed: false,
        workersAllowed: false,
        httpListeners: 1,
        stateSource: "reconstructed-runtime-native-state",
        targetResponse: { count: 3 },
      },
    });
    expect(summary.completedRecoveries).toEqual(
      expect.arrayContaining([
        "v8-isolate-and-heap-root-candidates",
        "libuv-loop-and-handle-candidates",
        "target-native-event-loop-entry",
      ]),
    );
    expect(summary.proofCommand).toBe("pnpm run smoke-node-proper-level5-proof");
  });
});
