import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "..", "..", "..", "..", "app", "cli", "src", "machinen.mjs");

describe("CLI", () => {
  it("shows help with no args", () => {
    const output = execSync(`node ${cli}`, { encoding: "utf-8" });
    expect(output).toContain("Usage: machinen");
    expect(output).toContain("up");
    expect(output).toContain("freeze");
    expect(output).toContain("restore");
    expect(output).toContain("status");
    expect(output).toContain("destroy");
  });

  it("shows help with unknown command", () => {
    try {
      execSync(`node ${cli} bogus`, { encoding: "utf-8", stdio: "pipe" });
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });

  it("freeze requires container name outside git repo", () => {
    try {
      // Run from /tmp so git branch auto-detect fails
      execSync(`node ${cli} freeze`, { encoding: "utf-8", stdio: "pipe", cwd: "/tmp" });
    } catch (err) {
      expect(err.stderr || err.stdout).toContain("Container name required");
      expect(err.status).toBe(1);
    }
  });

  it("restore requires container name outside git repo", () => {
    try {
      execSync(`node ${cli} restore`, { encoding: "utf-8", stdio: "pipe", cwd: "/tmp" });
    } catch (err) {
      expect(err.stderr || err.stdout).toContain("Container name required");
      expect(err.status).toBe(1);
    }
  });

  it("status requires container name outside git repo", () => {
    try {
      execSync(`node ${cli} status`, { encoding: "utf-8", stdio: "pipe", cwd: "/tmp" });
    } catch (err) {
      expect(err.stderr || err.stdout).toContain("Container name required");
      expect(err.status).toBe(1);
    }
  });
});
