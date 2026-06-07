import http from "node:http";
const memoryState = {
  kind: "process-signal-handler-refusal",
  anchor: "machinen-real-process-signal-handler-refusal-anchor-v1",
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-process-signal-handler-refusal-anchor-v1",
    marker: "process-native-boundary:process-signal-handler-refusal:unsupported",
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
