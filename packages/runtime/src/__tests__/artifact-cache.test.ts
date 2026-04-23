// Unit tests for the host-side artifact cache (#88).
//
// We stand up a fake "upstream" HTTP server on localhost and point
// the cache at it by overriding the upstream URL via the
// MACHINEN_NODE_DIST_UPSTREAM env var (test-only hook). The tests
// exercise miss → disk → hit, traversal rejection, upstream 404, and
// upstream failure.

import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnArtifactCache } from "../artifact-cache.ts";

interface Upstream {
  server: Server;
  port: number;
  requests: string[];
  setHandler: (fn: (path: string) => { status: number; body?: Buffer | string }) => void;
  close: () => Promise<void>;
}

async function startUpstream(): Promise<Upstream> {
  let handler: (path: string) => { status: number; body?: Buffer | string } = (path) => {
    if (path === "/v22.0.0/node-v22.0.0-linux-arm64.tar.xz") {
      return { status: 200, body: Buffer.from("fake-tarball-bytes") };
    }
    return { status: 404 };
  };
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const out = handler(req.url ?? "");
    res.statusCode = out.status;
    if (out.body !== undefined) {
      const buf = typeof out.body === "string" ? Buffer.from(out.body) : out.body;
      res.setHeader("content-length", String(buf.length));
      res.end(buf);
    } else {
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("upstream failed to bind");
  }
  return {
    server,
    port: addr.port,
    requests,
    setHandler(fn) {
      handler = fn;
    },
    async close() {
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function getBody(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, body };
}

describe("artifact-cache", () => {
  let cacheDir: string;
  let upstream: Upstream;
  const originalUpstream = process.env.MACHINEN_NODE_DIST_UPSTREAM;

  beforeEach(async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "machinen-cache-test-"));
    upstream = await startUpstream();
    process.env.MACHINEN_NODE_DIST_UPSTREAM = `http://127.0.0.1:${upstream.port}`;
  });

  afterEach(async () => {
    await upstream.close();
    rmSync(cacheDir, { recursive: true, force: true });
    if (originalUpstream === undefined) {
      delete process.env.MACHINEN_NODE_DIST_UPSTREAM;
    } else {
      process.env.MACHINEN_NODE_DIST_UPSTREAM = originalUpstream;
    }
  });

  it("fetches on miss, serves from disk on hit", async () => {
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const url = `http://127.0.0.1:${cache.port}/node-dist/v22.0.0/node-v22.0.0-linux-arm64.tar.xz`;

      const first = await getBody(url);
      expect(first.status).toBe(200);
      expect(first.body).toBe("fake-tarball-bytes");
      expect(upstream.requests).toHaveLength(1);

      const onDisk = join(cacheDir, "node-dist", "v22.0.0", "node-v22.0.0-linux-arm64.tar.xz");
      expect(existsSync(onDisk)).toBe(true);
      expect(readFileSync(onDisk, "utf8")).toBe("fake-tarball-bytes");

      const second = await getBody(url);
      expect(second.status).toBe(200);
      expect(second.body).toBe("fake-tarball-bytes");
      // Still 1 — the cache served from disk the second time.
      expect(upstream.requests).toHaveLength(1);
    } finally {
      await cache.stop();
    }
  });

  it("returns 404 when upstream says 404", async () => {
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const res = await getBody(`http://127.0.0.1:${cache.port}/node-dist/v99.0.0/nope.tar.xz`);
      expect(res.status).toBe(404);
    } finally {
      await cache.stop();
    }
  });

  it("returns 502 when upstream fetch fails", async () => {
    await upstream.close();
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const res = await getBody(`http://127.0.0.1:${cache.port}/node-dist/v22.0.0/x.tar.xz`);
      expect(res.status).toBe(502);
    } finally {
      await cache.stop();
    }
  });

  it("rejects path traversal", async () => {
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const res = await fetch(`http://127.0.0.1:${cache.port}/node-dist/..%2F..%2Fetc%2Fpasswd`);
      // Node normalizes the encoded slashes before we see them, so the
      // request shape is /node-dist/../../etc/passwd. Our normalize()
      // catches it.
      expect([400, 404]).toContain(res.status);
      await res.text();
    } finally {
      await cache.stop();
    }
  });

  it("rejects unknown cache kinds with 404", async () => {
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const res = await getBody(`http://127.0.0.1:${cache.port}/pnpm-store/xyz`);
      expect(res.status).toBe(404);
      expect(res.body).toContain("unknown cache kind");
    } finally {
      await cache.stop();
    }
  });

  it("rejects non-GET methods", async () => {
    const cache = await spawnArtifactCache({ cacheDir });
    try {
      const res = await fetch(`http://127.0.0.1:${cache.port}/node-dist/any`, {
        method: "POST",
      });
      expect(res.status).toBe(405);
      await res.text();
    } finally {
      await cache.stop();
    }
  });
});
