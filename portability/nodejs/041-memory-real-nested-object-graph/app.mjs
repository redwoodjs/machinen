import http from "node:http";
const memoryState = {
  kind: "nested-object-graph",
  anchor: "machinen-real-nested-anchor-v1",
  child: {
    label: "leaf",
    count: 3,
  },
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-nested-anchor-v1",
    child: "nested-child:leaf",
    count: "nested-count:3",
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
