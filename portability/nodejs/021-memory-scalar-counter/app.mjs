import http from "node:http";
const counter = (() => {
  const anchor = "machinen-memory-scalar-count-anchor-v1";
  let count = 41;
  return {
    anchor() {
      return anchor;
    },
    value() {
      return count;
    },
    inc() {
      count += 1;
      return count;
    },
  };
})();
globalThis.__machinenMemoryCounter = counter;
setInterval(() => globalThis.__machinenMemoryCounter.anchor(), 1000);
http
  .createServer((req, res) => {
    if (req.url === "/value") {
      res.end(String(counter.value()));
      return;
    }
    if (req.url === "/inc") {
      res.end(String(counter.inc()));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1");
