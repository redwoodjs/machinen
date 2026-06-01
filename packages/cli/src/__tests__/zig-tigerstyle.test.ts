import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ZIG_STYLE_BUDGET = {
  lineLengthViolations: 222,
  longFunctions: 33,
  minAssertions: 607,
  zeroAssertionFunctions: 472,
  plainDivisionOperators: 0,
  dynamicAllocationMentions: 180,
  usizeMentions: 471,
  configByValueParameters: 5,
  emptyCatchBlocks: 0,
  ignoredReturnAssignments: 321,
  defaultOptionStructs: 0,
  elseIfBranches: 24,
};

const zigFiles = spawnSync("git", ["ls-files", "*.zig"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
})
  .stdout.trim()
  .split("\n")
  .filter(Boolean)
  .filter((path) => !path.includes("/.zig-cache/"))
  .filter((path) => !path.startsWith("proofs/"));

type FunctionMetric = {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  assertionCount: number;
  recursiveCallCount: number;
};

function sanitizeZigSource(source: string): string {
  const out: string[] = [];
  let index = 0;
  let lineStart = true;
  let whitespaceOnly = true;

  while (index < source.length) {
    const byte = source[index];

    if (lineStart && whitespaceOnly) {
      let probe = index;
      while (probe < source.length && (source[probe] === " " || source[probe] === "\t")) {
        probe += 1;
      }
      if (source[probe] === "\\" && source[probe + 1] === "\\") {
        while (index < source.length && source[index] !== "\n") {
          out.push(" ");
          index += 1;
        }
        continue;
      }
    }

    if (byte === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") {
        out.push(" ");
        index += 1;
      }
      continue;
    }

    if (byte === '"') {
      out.push(" ");
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
          out.push(" ");
          out.push(" ");
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          out.push(" ");
          index += 1;
          break;
        }
        if (source[index] === "\n") {
          out.push("\n");
          lineStart = true;
          whitespaceOnly = true;
        } else {
          out.push(" ");
        }
        index += 1;
      }
      continue;
    }

    if (byte === "'") {
      out.push(" ");
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
          out.push(" ");
          out.push(" ");
          index += 2;
          continue;
        }
        if (source[index] === "'") {
          out.push(" ");
          index += 1;
          break;
        }
        out.push(source[index] === "\n" ? "\n" : " ");
        index += 1;
      }
      continue;
    }

    out.push(byte);
    if (byte === "\n") {
      lineStart = true;
      whitespaceOnly = true;
    } else {
      if (byte !== " " && byte !== "\t") {
        whitespaceOnly = false;
      }
      if (!whitespaceOnly) {
        lineStart = false;
      }
    }
    index += 1;
  }

  return out.join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function collectFunctionMetrics(): FunctionMetric[] {
  const metrics: FunctionMetric[] = [];
  const fnPattern = /\b(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const file of zigFiles) {
    const source = sanitizeZigSource(readFileSync(file, "utf8"));
    for (const match of source.matchAll(fnPattern)) {
      const name = match[1];
      let cursor = match.index + match[0].length;
      let bodyStart = -1;
      while (cursor < source.length) {
        if (source[cursor] === ";") {
          break;
        }
        if (source[cursor] === "{") {
          bodyStart = cursor;
          break;
        }
        cursor += 1;
      }
      if (bodyStart === -1) {
        continue;
      }

      let depth = 0;
      let bodyEnd = -1;
      for (cursor = bodyStart; cursor < source.length; cursor += 1) {
        if (source[cursor] === "{") {
          depth += 1;
        }
        if (source[cursor] === "}") {
          depth -= 1;
          if (depth === 0) {
            bodyEnd = cursor;
            break;
          }
        }
      }
      if (bodyEnd === -1) {
        continue;
      }

      const startLine = lineNumberAt(source, match.index);
      const endLine = lineNumberAt(source, bodyEnd);
      const body = source.slice(bodyStart, bodyEnd + 1);
      const recursiveCallPattern = new RegExp(
        `(?<![A-Za-z0-9_.])${escapeRegExp(name)}\\s*\\(`,
        "g",
      );
      metrics.push({
        file,
        name,
        startLine,
        endLine,
        lineCount: endLine - startLine + 1,
        assertionCount: Array.from(body.matchAll(/(?<![A-Za-z0-9_])(?:std\.debug\.)?assert\s*\(/g))
          .length,
        recursiveCallCount: Array.from(body.matchAll(recursiveCallPattern)).length,
      });
    }
  }

  return metrics;
}

function collectMatches(pattern: RegExp, options?: { sanitized?: boolean }): string[] {
  const matches: string[] = [];
  for (const file of zigFiles) {
    const raw = readFileSync(file, "utf8");
    const source = options?.sanitized ? sanitizeZigSource(raw) : raw;
    source.split("\n").forEach((line, index) => {
      const linePattern = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
      );
      for (const match of line.matchAll(linePattern)) {
        matches.push(`${file}:${index + 1}:${match[0]}`);
      }
    });
  }
  return matches;
}

function formatExamples(items: string[]): string {
  return items.slice(0, 10).join("\n");
}

describe("Zig TigerStyle guardrails", () => {
  it("passes zig fmt", () => {
    const result = spawnSync("zig", ["fmt", "--check", ...zigFiles], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("does not grow the >100-column line budget", () => {
    const violations: string[] = [];
    for (const file of zigFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.length > 100) {
          violations.push(`${file}:${index + 1}:${line.length}`);
        }
      });
    }

    expect(
      violations.length,
      `First overlong lines:\n${formatExamples(violations)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.lineLengthViolations);
  });

  it("does not grow the >70-line function budget", () => {
    const longFunctions = collectFunctionMetrics()
      .filter((metric) => metric.lineCount > 70)
      .map(
        (metric) =>
          `${metric.file}:${metric.startLine}-${metric.endLine} ${metric.name} (${metric.lineCount})`,
      );

    expect(
      longFunctions.length,
      `First long functions:\n${formatExamples(longFunctions)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.longFunctions);
  });

  it("keeps intentional infinite loops documented", () => {
    const undocumentedLoops: string[] = [];
    for (const file of zigFiles) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/\bwhile\s*\(\s*true\s*\)/.test(line)) {
          return;
        }
        const context = lines.slice(Math.max(0, index - 3), index).join("\n");
        if (
          !/(Intentional|EOF-bounded|reboot shouldn't|Shouldn't return|Park forever)/.test(context)
        ) {
          undocumentedLoops.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(
      undocumentedLoops,
      `Undocumented while(true) loops:\n${formatExamples(undocumentedLoops)}`,
    ).toEqual([]);
  });

  it("does not grow remaining TigerStyle debt budgets", () => {
    const plainDivisions = collectMatches(/(?<![/])\/(?![/=*])/, { sanitized: true });
    const dynamicAllocations = collectMatches(
      /\.(?:alloc|allocSentinel|allocPrint|dupe|dupeZ|create|realloc)\s*\(|\bArrayList(?:Unmanaged)?\b/,
      { sanitized: true },
    );
    const usizeMentions = collectMatches(/\busize\b/, { sanitized: true });
    const configByValue = collectMatches(/\bcfg\s*:\s*Config\b/, { sanitized: true });
    const emptyCatches = collectMatches(/catch\s*\{\s*\}/, { sanitized: true });
    const ignoredReturns = collectMatches(/_\s*=/, { sanitized: true });
    const defaultOptions = collectMatches(
      /std\.Thread\.spawn\s*\(\s*\.\{\}|std\.json\.parseFromSlice[^\n]*\.\{\}/,
      { sanitized: true },
    );
    const elseIfBranches = collectMatches(/\belse\s+if\b/, { sanitized: true });

    expect(
      plainDivisions.length,
      `First plain divisions:\n${formatExamples(plainDivisions)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.plainDivisionOperators);
    expect(
      dynamicAllocations.length,
      `First allocation mentions:\n${formatExamples(dynamicAllocations)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.dynamicAllocationMentions);
    expect(
      usizeMentions.length,
      `First usize mentions:\n${formatExamples(usizeMentions)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.usizeMentions);
    expect(
      configByValue.length,
      `First Config-by-value params:\n${formatExamples(configByValue)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.configByValueParameters);
    expect(
      emptyCatches.length,
      `First empty catches:\n${formatExamples(emptyCatches)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.emptyCatchBlocks);
    expect(
      ignoredReturns.length,
      `First ignored returns:\n${formatExamples(ignoredReturns)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.ignoredReturnAssignments);
    expect(
      defaultOptions.length,
      `First default option structs:\n${formatExamples(defaultOptions)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.defaultOptionStructs);
    expect(
      elseIfBranches.length,
      `First else-if branches:\n${formatExamples(elseIfBranches)}`,
    ).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.elseIfBranches);
  });

  it("does not allow direct recursive Zig functions", () => {
    const recursiveFunctions = collectFunctionMetrics()
      .filter((metric) => metric.recursiveCallCount > 0)
      .map((metric) => `${metric.file}:${metric.startLine} ${metric.name}`);

    expect(
      recursiveFunctions,
      `Recursive functions:\n${formatExamples(recursiveFunctions)}`,
    ).toEqual([]);
  });

  it("does not lose assertion coverage", () => {
    const functionMetrics = collectFunctionMetrics();
    const assertionCount = functionMetrics.reduce((sum, metric) => sum + metric.assertionCount, 0);
    const zeroAssertionFunctions = functionMetrics.filter(
      (metric) => metric.assertionCount === 0,
    ).length;

    expect(assertionCount).toBeGreaterThanOrEqual(ZIG_STYLE_BUDGET.minAssertions);
    expect(zeroAssertionFunctions).toBeLessThanOrEqual(ZIG_STYLE_BUDGET.zeroAssertionFunctions);
  });
});
