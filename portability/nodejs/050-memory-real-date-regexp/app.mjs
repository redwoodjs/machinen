import http from "node:http";

const date = new Date("2026-06-04T05:55:16.123Z");
const regexp = /machinen-(portable)-(date-regexp)/giu;
const memoryState = {
  kind: "date-regexp",
  anchor: "machinen-real-date-regexp-anchor-v1",
  dateIso: date.toISOString(),
  dateEpochMs: date.getTime(),
  regexpSource: regexp.source,
  regexpFlags: regexp.flags,
};
globalThis.__machinenRealMemoryState = {
  date,
  regexp,
  memoryState,
  anchors: {
    anchor: "machinen-real-date-regexp-anchor-v1",
    dateIso: "date-iso:2026-06-04T05:55:16.123Z",
    regexpSource: "regexp-source:machinen-(portable)-(date-regexp)",
    regexpFlags: "regexp-flags:giu",
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
