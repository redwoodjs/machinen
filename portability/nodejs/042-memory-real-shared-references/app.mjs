import http from "node:http";
const memoryState = {
  kind: "shared-references",
  anchor: "machinen-real-shared-anchor-v1",
  left: {
    ref: "alpha",
  },
  right: {
    ref: "alpha",
  },
  sharedIdentity: true,
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-shared-anchor-v1",
    shared: "shared-node:alpha",
  },
};
setInterval(() => {
  void globalThis.__machinenRealMemoryState;
}, 1000);
http
  .createServer((req, res) => {
    if (req.url === "/value") {
      res.end("memory-ready");
      return;
    }
    if (req.url === "/state") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(memoryState));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(3000, "127.0.0.1");
