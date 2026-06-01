import { createServer } from "node:http";
import { openSync } from "node:fs";

const activeMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 97, 99, 116, 105, 118,
  101, 45, 104, 116, 116, 112, 45, 114, 101, 113, 117, 101, 115, 116, 45, 108, 105, 118, 101, 45,
  118, 49,
];
const busyMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 97, 99, 116, 105, 118,
  101, 45, 106, 115, 45, 99, 97, 108, 108, 98, 97, 99, 107, 45, 108, 105, 118, 101, 45, 118, 49,
];
const syscallMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 97, 99, 116, 105, 118,
  101, 45, 98, 108, 111, 99, 107, 105, 110, 103, 45, 115, 121, 115, 99, 97, 108, 108, 45, 108, 105,
  118, 101, 45, 118, 49,
];

function setMarker(bytes, key) {
  const marker = String.fromCharCode(...bytes);
  globalThis[marker] = true;
  globalThis[key] = {
    marker,
    markerBytes: Buffer.from(bytes),
    startedAt: Date.now(),
  };
  return marker;
}

function makeHandler() {
  const machinenLevel5ContextAnchor = "machinen-level5-v8-context-anchor-v1";
  let count = 0;
  return function machinenThreadContinuationHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url === "/active") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          active: Boolean(globalThis.machinenActiveHttpRequest),
          busy: Boolean(globalThis.machinenActiveJsCallback),
          blockingSyscall: Boolean(globalThis.machinenActiveBlockingSyscall),
        }) + "\n",
      );
      return;
    }
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ count }) + "\n");
      return;
    }
    if (req.url === "/hold") {
      const activeMarker = setMarker(activeMarkerBytes, "machinenActiveHttpRequest");
      setTimeout(() => {
        delete globalThis[activeMarker];
        globalThis.machinenActiveHttpRequest = undefined;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("released\n");
      }, 30000);
      return;
    }
    if (req.url === "/busy") {
      setMarker(busyMarkerBytes, "machinenActiveJsCallback");
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        Math.sqrt(Math.random());
      }
      globalThis.machinenActiveJsCallback = undefined;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("busy-done\n");
      return;
    }
    if (req.url === "/blocking-syscall") {
      setMarker(syscallMarkerBytes, "machinenActiveBlockingSyscall");
      openSync("/tmp/machinen-proof-032-fifo", "r");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("syscall-done\n");
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: ++count }) + "\n");
  };
}

createServer(makeHandler()).listen(3000, "127.0.0.1");
