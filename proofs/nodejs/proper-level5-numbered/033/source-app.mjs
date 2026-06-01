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
const unsupportedProxyBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 118, 56, 45, 117, 110,
  115, 117, 112, 112, 111, 114, 116, 101, 100, 45, 112, 114, 111, 120, 121, 45, 118, 49,
];
const historyOneBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 104, 101, 97, 112, 45, 104, 105, 115, 116, 111, 114,
  121, 45, 101, 110, 116, 114, 121, 45, 48, 48, 48, 49,
];
const historyTwoBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 104, 101, 97, 112, 45, 104, 105, 115, 116, 111, 114,
  121, 45, 101, 110, 116, 114, 121, 45, 48, 48, 48, 50,
];
const sharedLeafBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 104, 101, 97, 112, 45, 115, 104, 97, 114, 101, 100, 45,
  108, 101, 97, 102, 45, 118, 49,
];

function text(bytes) {
  return String.fromCharCode(...bytes);
}

function setMarker(bytes, key) {
  const marker = text(bytes);
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
  const graphAnchor = "machinen-level5-v8-heap-graph-anchor-v1";
  let translatedTotalCell = 0;
  const sharedLeaf = { marker: text(sharedLeafBytes), hits: 0 };
  const graph = {
    anchor: graphAnchor,
    total: 0,
    name: "graph-alpha",
    history: [],
    left: { name: "left-node", shared: sharedLeaf },
    right: { name: "right-node", shared: sharedLeaf },
    packed: [1, 2, sharedLeaf],
  };
  globalThis.machinenHeapGraphRetainer = graph;

  function response() {
    return {
      total: graph.total,
      historyLength: graph.history.length,
      leftSharedIsRightShared: graph.left.shared === graph.right.shared,
      packedSharedIsSame: graph.packed[2] === graph.left.shared,
      sharedHits: sharedLeaf.hits,
      name: graph.name,
    };
  }

  return function machinenV8HeapGraphHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0 || graph.anchor.length === 0) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url === "/active") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          active: Boolean(globalThis.machinenActiveHttpRequest),
          busy: Boolean(globalThis.machinenActiveJsCallback),
          blockingSyscall: Boolean(globalThis.machinenActiveBlockingSyscall),
          unsupportedProxy: Boolean(globalThis.machinenUnsupportedProxy),
        }) + "\n",
      );
      return;
    }
    if (req.url === "/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response()) + "\n");
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
      openSync("/tmp/machinen-proof-033-fifo", "r");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("syscall-done\n");
      return;
    }
    if (req.url === "/unsupported") {
      setMarker(unsupportedProxyBytes, "machinenUnsupportedProxy");
      graph.unsupported = new Proxy({ sparse: [] }, {});
      graph.unsupported.sparse[10] = "hole";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("unsupported-shape-installed\n");
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    graph.total += 1;
    translatedTotalCell = graph.total;
    if (translatedTotalCell !== graph.total) {
      throw new Error("unreachable total guard");
    }
    sharedLeaf.hits += 1;
    graph.history.push(graph.total === 1 ? text(historyOneBytes) : text(historyTwoBytes));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response()) + "\n");
  };
}

createServer(makeHandler()).listen(3000, "127.0.0.1");
