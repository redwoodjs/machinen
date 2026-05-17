import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ZIG_STYLE_BUDGET = {
  lineLengthViolations: 233,
  longFunctions: 33,
  minAssertions: 583,
  zeroAssertionFunctions: 473,
};

const zigFiles = spawnSync("git", ["ls-files", "*.zig"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
})
  .stdout.trim()
  .split("\n")
  .filter(Boolean)
  .filter((path) => !path.includes("/.zig-cache/"));

type FunctionMetric = {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  assertionCount: number;
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
      metrics.push({
        file,
        name,
        startLine,
        endLine,
        lineCount: endLine - startLine + 1,
        assertionCount: Array.from(body.matchAll(/(?<![A-Za-z0-9_])(?:std\.debug\.)?assert\s*\(/g))
          .length,
      });
    }
  }

  return metrics;
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
