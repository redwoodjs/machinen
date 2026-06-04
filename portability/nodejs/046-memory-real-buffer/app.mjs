import http from "node:http";
const memoryState = {
  kind: "buffer",
  anchor: "machinen-real-buffer-anchor-v1",
  utf8: "machinen",
  hex: "6d616368696e656e",
};
globalThis.__machinenBuffer = Buffer.from(memoryState.hex, "hex");
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-buffer-anchor-v1",
    bytes: "buffer-bytes:6d616368696e656e",
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
