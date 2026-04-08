import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..");

describe("power-helper", () => {
  it("swift source file exists", () => {
    expect(fs.existsSync(path.join(srcDir, "power-helper.swift"))).toBe(true);
  });

  it("compiled binary exists", () => {
    expect(fs.existsSync(path.join(srcDir, "power-helper"))).toBe(true);
  });

  it("binary is executable", () => {
    const stats = fs.statSync(path.join(srcDir, "power-helper"));
    // Check owner execute bit
    expect(stats.mode & 0o100).toBeTruthy();
  });
});

describe("power.mjs", () => {
  it("exports createPowerWatcher", async () => {
    const mod = await import("../power");
    expect(typeof mod.createPowerWatcher).toBe("function");
  });
});
