// Host-side artifact cache sidecar (issue #88).
//
// One supervised Node HTTP server, co-located with gvproxy. Serves
// caches on http://127.0.0.1:<port>/<kind>/... — reachable from the
// guest at http://192.168.127.1:<port>/... because gvproxy maps the
// gateway address to the host's loopback.
//
// First and only cache kind today: "node-dist", mirroring
// nodejs.org/dist/ for `fnm`. The pattern (supervision, cache-dir
// layout, config-wiring) generalizes — future kinds (pnpm, npm, apt)
// plug in as additional route prefixes.
//
// Plain HTTP guest-side so no CA cert needs to live in the rootfs
// trust store. HTTPS is used upstream, where normal system trust
// applies.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { CacheError } from "./errors.ts";

// Upstream for the node-dist mirror. Env-overridable so tests can
// point at a localhost stub without hitting nodejs.org.
function nodeDistUpstream(): string {
  return process.env.MACHINEN_NODE_DIST_UPSTREAM ?? "https://nodejs.org/dist";
}

export interface ArtifactCacheHandle {
  /** Port the cache is listening on (127.0.0.1:<port>). */
  port: number;
  /** Absolute path to the on-disk cache root. */
  cacheDir: string;
  /** Shut the server down and close its sockets. Idempotent. */
  stop: () => Promise<void>;
}

export interface ArtifactCacheOptions {
  /**
   * Root directory for on-disk caches. Each kind lives under
   * `<cacheDir>/<kind>/`. Defaults to `$MACHINEN_CACHE_DIR` if set,
   * else `~/.machinen/cache`.
   */
  cacheDir?: string;
}

/**
 * Resolve the cache root using env override → default. Pulled out so
 * tests and callers that need to inspect the path agree with what
 * spawnArtifactCache() will pick.
 */
export function resolveCacheDir(opts: ArtifactCacheOptions = {}): string {
  if (opts.cacheDir) {
    return resolve(opts.cacheDir);
  }
  const env = process.env.MACHINEN_CACHE_DIR;
  if (env) {
    return resolve(env);
  }
  return join(homedir(), ".machinen", "cache");
}

/**
 * Start the host-side artifact cache on an ephemeral loopback port.
 * The returned handle stays valid until `stop()` is called.
 */
export async function spawnArtifactCache(
  opts: ArtifactCacheOptions = {},
): Promise<ArtifactCacheHandle> {
  const cacheDir = resolveCacheDir(opts);
  await mkdir(join(cacheDir, "node-dist"), { recursive: true });

  const server = createServer((req, res) => {
    handleRequest(req, res, cacheDir).catch((err) => {
      // Last-ditch: the handler is supposed to catch everything and
      // write a response. If it throws we still need to close the
      // socket so the guest doesn't hang.
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
        res.end(`artifact-cache: ${err instanceof Error ? err.message : String(err)}\n`);
      } else {
        res.destroy();
      }
    });
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      done();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new CacheError("CACHE_BIND_FAILED", "artifact-cache: failed to read bound address");
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    await new Promise<void>((done) => {
      server.close(() => done());
      // Active keep-alive connections would hold close() open forever.
      // closeAllConnections is available on Node 18.2+, which matches
      // our baseline.
      server.closeAllConnections?.();
    });
  };

  return { port: addr.port, cacheDir, stop };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cacheDir: string,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end();
    return;
  }

  const url = req.url ?? "/";
  const qIdx = url.indexOf("?");
  const rawPath = qIdx >= 0 ? url.slice(0, qIdx) : url;

  // Expected shape: /<kind>/<rest...>
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.length < 2) {
    res.statusCode = 404;
    res.end("not a cache route\n");
    return;
  }
  const kind = parts[0];
  const rest = parts.slice(1).join("/");

  if (kind !== "node-dist") {
    res.statusCode = 404;
    res.end(`unknown cache kind: ${kind}\n`);
    return;
  }

  // Traversal guard: build the on-disk path, normalize it, and check
  // it still sits under the kind's cache root.
  const kindDir = join(cacheDir, "node-dist");
  const localPath = normalize(join(kindDir, rest));
  if (!localPath.startsWith(kindDir + sep) && localPath !== kindDir) {
    res.statusCode = 400;
    res.end("path traversal rejected\n");
    return;
  }

  // Cache hit — stream from disk.
  try {
    const st = await stat(localPath);
    if (st.isFile()) {
      res.statusCode = 200;
      res.setHeader("content-length", String(st.size));
      res.setHeader("content-type", "application/octet-stream");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      await pipeline(createReadStream(localPath), res);
      return;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // Miss — fetch upstream, tee to disk, stream to client.
  const upstream = `${nodeDistUpstream()}/${rest}`;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain");
    res.end(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  if (upstreamRes.status === 404) {
    res.statusCode = 404;
    res.end("not found upstream\n");
    return;
  }
  if (!upstreamRes.ok || !upstreamRes.body) {
    res.statusCode = 502;
    res.end(`upstream returned ${upstreamRes.status}\n`);
    return;
  }

  // Buffer the whole response before responding. Node tarballs max
  // around 30 MB; holding that in memory is cheaper than the
  // tee-with-backpressure dance, and it lets us write to disk and
  // serve the client with the exact same bytes. If a future kind
  // (apt, pnpm-store) brings much larger artifacts, revisit.
  let body: Buffer;
  try {
    body = Buffer.from(await upstreamRes.arrayBuffer());
  } catch (err) {
    res.statusCode = 502;
    res.end(`upstream stream failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  await mkdir(dirname(localPath), { recursive: true });
  // Write to a sibling temp file, then atomic-rename into place. If
  // rename fails the partial is left for the next request to
  // overwrite — cheap and self-healing.
  const tmpPath = `${localPath}.${process.pid}.${Date.now()}.part`;
  try {
    await writeFile(tmpPath, body);
    await rename(tmpPath, localPath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {}
    res.statusCode = 500;
    res.end(`cache write failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-length", String(body.length));
  res.setHeader(
    "content-type",
    upstreamRes.headers.get("content-type") ?? "application/octet-stream",
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}
