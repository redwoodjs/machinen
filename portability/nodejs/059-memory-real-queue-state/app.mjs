import http from "node:http";
const queue = [
  { id: "job-001", priority: 9 },
  { id: "job-002", priority: 5 },
  { id: "job-003", priority: 3 },
  { id: "job-004", priority: 1 },
];
const processed = [queue.shift().id];
const memoryState = {
  kind: "queue-state",
  anchor: "machinen-real-queue-state-anchor-v1",
  headIndex: 1,
  tailIndex: 3,
  pending: queue,
  processed,
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-queue-state-anchor-v1",
    head: "queue-head:job-002",
    tail: "queue-tail:job-004",
    items: "queue-items:job-002,job-003,job-004",
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
