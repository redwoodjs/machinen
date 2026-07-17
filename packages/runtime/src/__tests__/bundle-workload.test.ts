import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { planBundleCommand, type ResolvedLiveMount } from "../vm/bundle.ts";

const writableMount: ResolvedLiveMount = {
  host: "/host/work",
  guest: "/mnt/work",
  mode: "rw",
  tag: "machinen-lm0",
};

describe("writable live-mount workload command", () => {
  it("passes the original argv directly to the guest supervisor", () => {
    const workload = ["/bin/echo", "hello world", "'quoted'"];

    expect(planBundleCommand({ cmd: workload }, undefined, [writableMount])).toEqual([
      "/sbin/machinen-supervisor",
      ...workload,
    ]);
  });

  it("does not add a shell layer that can detach interactive stdin", () => {
    const workload = ["/bin/sh", "-c", 'IFS= read -r line && printf "got:%s\\n" "$line"'];
    const planned = planBundleCommand({ cmd: workload }, undefined, [writableMount]);
    const directWorkload = planned.slice(1);
    const result = spawnSync(directWorkload[0]!, directWorkload.slice(1), {
      input: "hello\n",
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("got:hello\n");
  });
});
