import http from "node:http";
const memoryState = {
  kind: "closure-context",
  anchor: "machinen-real-closure-anchor-v1",
  count: 12,
  next: 13,
};
globalThis.__machinenClosure = (() => {
  const anchor = memoryState.anchor;
  let count = memoryState.count;
  return () => ({ anchor, count: ++count });
})();
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-closure-anchor-v1",
    count: "closure-count:12",
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
