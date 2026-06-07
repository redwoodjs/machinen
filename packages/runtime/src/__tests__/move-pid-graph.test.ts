import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MOVE_REFUSAL_CODE,
  buildMoveIssueReport,
  loadMoveDescriptor,
  saveMoveDescriptor,
  scanMovePidGraph,
} from "../move-pid-graph.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "machinen-move-"));
  TMP.push(dir);
  return dir;
}

describe("move PID graph", () => {
  it("scans a PID graph with translated and refused state classes", () => {
    const graph = scanMovePidGraph(process.pid);
    expect(graph.kind).toBe("machinen.move.pid-graph");
    expect(graph.nodes[0]?.pid).toBe(process.pid);
    expect(graph.translatedStateClasses).toContain("argv-env-cwd");
    expect(graph.refusedStateClasses.map((item) => item.stateClass)).toEqual([
      "open-files",
      "sockets",
    ]);
  });

  it("saves a descriptor fail-closed and can load it", () => {
    const out = join(tempDir(), "move.json");
    const result = saveMoveDescriptor({ pid: process.pid, outPath: out, issue: true });
    expect(result.accepted).toBe(false);
    expect(result.refusalCode).toBe(MOVE_REFUSAL_CODE);
    expect(result.issueReport?.repository).toBe("redwoodjs/machinen");

    const raw = JSON.parse(readFileSync(out, "utf8"));
    expect(raw.kind).toBe("machinen.move.descriptor");
    expect(loadMoveDescriptor(out).productSurface).toBe("machinen move");
  });

  it("builds a redacted issue report from refusal evidence", () => {
    const descriptor = saveMoveDescriptor({
      pid: process.pid,
      outPath: join(tempDir(), "m.json"),
    }).descriptor;
    const report = buildMoveIssueReport(descriptor, "owner/repo");
    expect(report.repository).toBe("owner/repo");
    expect(report.body).toContain("refused classes: open-files, sockets");
    expect(report.body).not.toContain(process.cwd());
  });
});
