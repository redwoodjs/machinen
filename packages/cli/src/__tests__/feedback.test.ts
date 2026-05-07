import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendFeedback, postUpstream, readFeedback } from "../feedback.ts";

let workDir: string;
let path: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "machinen-feedback-test-"));
  path = join(workDir, "feedback.jsonl");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("feedback file I/O", () => {
  it("appendFeedback creates the parent dir and writes one JSON object per line", () => {
    appendFeedback(
      { timestamp: "2026-05-07T00:00:00Z", cli_version: "0.0.0", text: "first" },
      path,
    );
    appendFeedback(
      { timestamp: "2026-05-07T00:00:01Z", cli_version: "0.0.0", text: "second" },
      path,
    );
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).text).toBe("first");
    expect(JSON.parse(lines[1]!).text).toBe("second");
  });

  it("readFeedback returns [] for a missing file", () => {
    expect(readFeedback(path)).toEqual([]);
  });

  it("readFeedback skips malformed lines instead of throwing", () => {
    appendFeedback({ timestamp: "2026-05-07T00:00:00Z", cli_version: "0.0.0", text: "good" }, path);
    // Append a half-finished line that JSON.parse can't handle.
    appendFileSync(path, "{not json\n");
    appendFeedback(
      { timestamp: "2026-05-07T00:00:02Z", cli_version: "0.0.0", text: "also good" },
      path,
    );
    const entries = readFeedback(path);
    expect(entries.map((e) => e.text)).toEqual(["good", "also good"]);
  });
});

describe("postUpstream", () => {
  it("returns attempted=false when no endpoint is configured", async () => {
    const res = await postUpstream({ timestamp: "t", cli_version: "v", text: "hi" }, undefined);
    expect(res.attempted).toBe(false);
    expect(res.status).toBeNull();
    expect(res.error).toBeNull();
  });

  it("captures network failures without throwing", async () => {
    // An unroutable URL — fetch will reject, postUpstream should
    // surface the error message instead of throwing.
    const res = await postUpstream(
      { timestamp: "t", cli_version: "v", text: "hi" },
      "http://127.0.0.1:1/never",
    );
    expect(res.attempted).toBe(true);
    expect(res.status).toBeNull();
    expect(typeof res.error).toBe("string");
  });
});
