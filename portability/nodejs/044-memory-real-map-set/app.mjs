import http from "node:http";
const memoryState = {
  kind: "map-set",
  anchor: "machinen-real-map-set-anchor-v1",
  mapEntries: [["answer", 42]],
  setEntries: ["portable"],
};
globalThis.__machinenMap = new Map(memoryState.mapEntries);
globalThis.__machinenSet = new Set(memoryState.setEntries);
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-map-set-anchor-v1",
    map: "map-entry:answer=42",
    set: "set-entry:portable",
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
