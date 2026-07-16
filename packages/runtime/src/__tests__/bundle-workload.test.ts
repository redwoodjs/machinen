import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { wrapBatchWorkloadCommand } from "../vm/bundle.ts";

describe("writable live-mount workload wrapper", () => {
  it("preserves stdin for the asynchronous workload", () => {
    const wrapped = wrapBatchWorkloadCommand([
      "/bin/sh",
      "-c",
      'IFS= read -r line && printf "got:%s\\n" "$line"',
    ]);
    const result = spawnSync(wrapped[0]!, wrapped.slice(1), {
      input: "hello\n",
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("got:hello\n");
  });
});
