import http from "node:http";
const capacity = 3;
const cache = new Map();
const evictedKeys = [];
function put(key, value) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > capacity) {
    const oldest = cache.keys().next().value;
    evictedKeys.push(oldest);
    cache.delete(oldest);
  }
}
put("alpha", { hits: 1 });
put("beta", { hits: 2 });
put("gamma", { hits: 3 });
put("delta", { hits: 4 });
const memoryState = {
  kind: "in-memory-lru-cache",
  anchor: "machinen-real-lru-cache-anchor-v1",
  capacity,
  entriesLeastToMostRecent: [...cache.entries()],
  evictedKeys,
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-lru-cache-anchor-v1",
    keys: "lru-cache-keys:beta,gamma,delta",
    evicted: "lru-cache-evicted:alpha",
    capacity: "lru-cache-capacity:3",
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
