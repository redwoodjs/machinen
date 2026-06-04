import http from "node:http";
const memoryState = {
  kind: "distributed-rate-limit-refusal",
  anchor: "machinen-real-distributed-rate-limit-refusal-anchor-v1",
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-distributed-rate-limit-refusal-anchor-v1",
    marker: "rate-limiting:distributed-rate-limit-refusal:unsupported",
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
