import http from "node:http";

const singleton = {
  moduleName: "machinen-portable-singleton-module-v1",
  counter: 17,
  token: "machinen-singleton-token-v1",
  nested: { warmed: true, label: "machinen-singleton-nested-label-v1" },
};
function touchSingleton() {
  singleton.counter += 2;
  singleton.lastTouch = "machinen-singleton-last-touch-v1";
}
touchSingleton();
const memoryState = {
  kind: "module-singleton-state",
  anchor: "machinen-real-module-singleton-anchor-v1",
  moduleName: singleton.moduleName,
  counter: singleton.counter,
  token: singleton.token,
  nested: singleton.nested,
  lastTouch: singleton.lastTouch,
};
globalThis.__machinenRealMemoryState = {
  singleton,
  memoryState,
  anchors: {
    anchor: "machinen-real-module-singleton-anchor-v1",
    module: "module-singleton-name:machinen-portable-singleton-module-v1",
    counter: "module-singleton-counter:19",
    token: "module-singleton-token:machinen-singleton-token-v1",
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
