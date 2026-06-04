import http from "node:http";
const memoryState = {
  kind: "class-instance",
  anchor: "machinen-real-class-anchor-v1",
  className: "Counter",
  count: 9,
  methodResult: 10,
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-class-anchor-v1",
    name: "class-name:Counter",
    count: "class-count:9",
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
