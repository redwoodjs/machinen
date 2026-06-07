import http from "node:http";
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function auditListener() {
  return "audit-listener";
}
function metricsListener() {
  return "metrics-listener";
}
emitter.on("portable-event", auditListener);
emitter.on("portable-event", metricsListener);
const memoryState = {
  kind: "eventemitter-listeners",
  anchor: "machinen-real-eventemitter-listeners-anchor-v1",
  eventName: "portable-event",
  listenerCount: emitter.listenerCount("portable-event"),
  listenerLabels: ["audit-listener", "metrics-listener"],
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-eventemitter-listeners-anchor-v1",
    event: "eventemitter-event:portable-event",
    listeners: "eventemitter-listeners:2",
    listenerLabel: "eventemitter-listener-label:audit-listener",
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
