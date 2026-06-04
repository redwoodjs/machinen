import http from "node:http";
const memoryState = {
  kind: "cycle",
  anchor: "machinen-real-cycle-anchor-v1",
  node: {
    name: "self",
  },
  cyclePreserved: true,
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-cycle-anchor-v1",
    cycle: "cycle-node:self",
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
