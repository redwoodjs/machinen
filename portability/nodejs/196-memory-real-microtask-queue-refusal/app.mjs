import http from "node:http";
const memoryState = {
  kind: "microtask-queue-refusal",
  anchor: "machinen-real-microtask-queue-refusal-anchor-v1",
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-microtask-queue-refusal-anchor-v1",
    marker: "promise-detail:microtask-queue-refusal:unsupported",
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
