import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// We test the state functions by overriding the STATE_FILE path.
// Since cloud.mjs hardcodes it, we'll test the logic directly.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "machinen-test-"));
const stateFile = path.join(tmpDir, "state.json");

function loadAllState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveAllState(all) {
  fs.writeFileSync(stateFile, JSON.stringify(all, null, 2) + "\n");
}

function loadState(key) {
  const all = loadAllState();
  if (key) return all[key] || {};
  const keys = Object.keys(all);
  return keys.length > 0 ? all[keys[0]] : {};
}

function saveState(key, updates) {
  const all = loadAllState();
  all[key] = { ...(all[key] || {}), ...updates };
  saveAllState(all);
  return all[key];
}

function deleteState(key) {
  const all = loadAllState();
  delete all[key];
  if (Object.keys(all).length === 0) {
    try { fs.unlinkSync(stateFile); } catch {}
  } else {
    saveAllState(all);
  }
}

function listState() {
  return loadAllState();
}

beforeEach(() => {
  try { fs.unlinkSync(stateFile); } catch {}
});

afterEach(() => {
  try { fs.unlinkSync(stateFile); } catch {}
});

describe("state management", () => {
  it("returns empty object when no state file exists", () => {
    expect(loadState("foo")).toEqual({});
    expect(loadState()).toEqual({});
  });

  it("saves and loads state by key", () => {
    saveState("container-a", { ip: "1.2.3.4", mode: "local" });
    expect(loadState("container-a")).toEqual({ ip: "1.2.3.4", mode: "local" });
  });

  it("merges updates into existing state", () => {
    saveState("container-a", { ip: "1.2.3.4", mode: "local" });
    saveState("container-a", { mode: "remote", serverId: 123 });
    expect(loadState("container-a")).toEqual({
      ip: "1.2.3.4",
      mode: "remote",
      serverId: 123,
    });
  });

  it("supports multiple containers independently", () => {
    saveState("container-a", { ip: "1.2.3.4" });
    saveState("container-b", { ip: "5.6.7.8" });

    expect(loadState("container-a")).toEqual({ ip: "1.2.3.4" });
    expect(loadState("container-b")).toEqual({ ip: "5.6.7.8" });
  });

  it("loadState without key returns first entry", () => {
    saveState("container-a", { ip: "1.2.3.4" });
    saveState("container-b", { ip: "5.6.7.8" });

    const state = loadState();
    expect(state.ip).toBe("1.2.3.4");
  });

  it("deleteState removes a single container", () => {
    saveState("container-a", { ip: "1.2.3.4" });
    saveState("container-b", { ip: "5.6.7.8" });

    deleteState("container-a");

    expect(loadState("container-a")).toEqual({});
    expect(loadState("container-b")).toEqual({ ip: "5.6.7.8" });
  });

  it("deleteState removes file when last entry is deleted", () => {
    saveState("container-a", { ip: "1.2.3.4" });
    deleteState("container-a");

    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it("listState returns all entries", () => {
    saveState("container-a", { ip: "1.2.3.4" });
    saveState("container-b", { ip: "5.6.7.8" });

    const all = listState();
    expect(Object.keys(all)).toEqual(["container-a", "container-b"]);
    expect(all["container-a"].ip).toBe("1.2.3.4");
    expect(all["container-b"].ip).toBe("5.6.7.8");
  });
});
