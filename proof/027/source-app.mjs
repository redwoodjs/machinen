import { createServer } from "node:http";

const activeMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 97, 99, 116, 105, 118,
  101, 45, 104, 116, 116, 112, 45, 114, 101, 113, 117, 101, 115, 116, 45, 108, 105, 118, 101, 45,
  118, 49,
];

function makeHandler() {
  const machinenLevel5ContextAnchor = "machinen-level5-v8-context-anchor-v1";
  let count = 0;
  return function machinenHttpStatePolicyHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url === "/active") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ active: Boolean(globalThis.machinenActiveHttpRequest) }) + "\n");
      return;
    }
    if (req.url === "/hold") {
      const activeMarker = String.fromCharCode(...activeMarkerBytes);
      globalThis[activeMarker] = true;
      globalThis.machinenActiveHttpRequest = {
        marker: activeMarker,
        markerBytes: Buffer.from(activeMarkerBytes),
        startedAt: Date.now(),
      };
      setTimeout(() => {
        const activeMarker = String.fromCharCode(...activeMarkerBytes);
        delete globalThis[activeMarker];
        globalThis.machinenActiveHttpRequest = undefined;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("released\n");
      }, 30000);
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
