import http from "node:http";

const url = new URL("https://example.test:8443/portable/path?alpha=1&beta=two&beta=three#frag");
url.searchParams.set("gamma", "machinen");
const memoryState = {
  kind: "url-searchparams",
  anchor: "machinen-real-url-searchparams-anchor-v1",
  href: url.href,
  origin: url.origin,
  pathname: url.pathname,
  search: url.search,
  params: [...url.searchParams.entries()],
};
globalThis.__machinenRealMemoryState = {
  url,
  memoryState,
  anchors: {
    anchor: "machinen-real-url-searchparams-anchor-v1",
    href: "url-href:https://example.test:8443/portable/path?alpha=1&beta=two&beta=three&gamma=machinen#frag",
    search: "url-search:?alpha=1&beta=two&beta=three&gamma=machinen",
    params: "url-params:alpha=1,beta=two,beta=three,gamma=machinen",
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
