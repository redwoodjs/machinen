import http from "node:http";
const memoryState = {
  kind: "sticky-global-regexp-state",
  anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
    marker: "regexp-detail:sticky-global-regexp-state:unsupported",
  },
};
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
