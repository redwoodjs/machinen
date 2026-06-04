import http from "node:http";
const memoryState = {
  kind: "typed-array",
  anchor: "machinen-real-typed-array-anchor-v1",
  constructor: "Uint32Array",
  values: [7, 11, 13],
};
globalThis.__machinenTypedArray = new Uint32Array(memoryState.values);
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-typed-array-anchor-v1",
    values: "typed-array-values:7,11,13",
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
