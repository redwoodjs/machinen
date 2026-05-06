// Unit tests for the host-side page-server spawn wrapper. Exercises
// the parts that are testable on any host: binary resolution and the
// stub spawn lifecycle. End-to-end protocol behaviour is covered by
// the smoke RSS test in scripts/smoke-tests.sh, which needs a real
// CRIU bundle + lazy-pages client to exercise.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMachinenError } from "../errors.ts";
import {
  HOST_GATEWAY_IP_FROM_GUEST,
  resolvePageServerBinary,
  spawnPageServer,
} from "../page-server.ts";

describe("resolvePageServerBinary", () => {
  it("honors MACHINEN_PAGE_SERVER override", () => {
    const dir = mkdtempSync(join(tmpdir(), "ps-resolve-"));
    const fakeBin = join(dir, "fake-page-server");
    writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const prev = process.env.MACHINEN_PAGE_SERVER;
    process.env.MACHINEN_PAGE_SERVER = fakeBin;
    try {
      expect(resolvePageServerBinary()).toBe(fakeBin);
    } finally {
      if (prev === undefined) {
        delete process.env.MACHINEN_PAGE_SERVER;
      } else {
        process.env.MACHINEN_PAGE_SERVER = prev;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects MACHINEN_PAGE_SERVER pointing at a missing file", () => {
    const prev = process.env.MACHINEN_PAGE_SERVER;
    process.env.MACHINEN_PAGE_SERVER = "/nonexistent/path/page-server";
    try {
      expect(() => resolvePageServerBinary()).toThrow(/does not exist/);
    } finally {
      if (prev === undefined) {
        delete process.env.MACHINEN_PAGE_SERVER;
      } else {
        process.env.MACHINEN_PAGE_SERVER = prev;
      }
    }
  });
});

describe("spawnPageServer", () => {
  // We use a sleep binary as a stand-in for the page-server. It's enough
  // to validate that spawnPageServer reaches the "binary stayed up past
  // the early-exit window" branch, picks an ephemeral port, and exposes
  // a working stop().
  let stub: string;
  let stubDir: string;
  let imgDir: string;

  beforeAll(() => {
    stubDir = mkdtempSync(join(tmpdir(), "ps-stub-"));
    stub = join(stubDir, "stub-page-server");
    writeFileSync(stub, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    imgDir = mkdtempSync(join(tmpdir(), "ps-imgs-"));
  });

  afterAll(() => {
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(imgDir, { recursive: true, force: true });
  });

  it("returns a port + guestEndpoint and tears down on stop()", async () => {
    const handle = await spawnPageServer({ binary: stub, imgDir });
    try {
      expect(handle.port).toBeGreaterThan(1024);
      expect(handle.guestEndpoint).toBe(`${HOST_GATEWAY_IP_FROM_GUEST}:${handle.port}`);
      expect(handle.child.exitCode).toBeNull();
    } finally {
      handle.stop();
    }
    // SIGTERM → exit. Wait for the exit to land before asserting.
    await new Promise<void>((resolve_) => {
      handle.child.once("exit", () => resolve_());
    });
    expect(handle.child.exitCode === null && handle.child.signalCode === null).toBe(false);
  });

  it("surfaces early exits as PAGE_SERVER_FAILED", async () => {
    const fastFailDir = mkdtempSync(join(tmpdir(), "ps-fail-"));
    const failBin = join(fastFailDir, "fail-page-server");
    writeFileSync(failBin, "#!/bin/sh\necho boom >&2\nexit 7\n", { mode: 0o755 });
    try {
      await expect(spawnPageServer({ binary: failBin, imgDir })).rejects.toSatisfy((err) =>
        isMachinenError(err, "PAGE_SERVER_FAILED"),
      );
    } finally {
      rmSync(fastFailDir, { recursive: true, force: true });
    }
  });
});
