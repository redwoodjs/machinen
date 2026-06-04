import http from "node:http";
const localSymbol = Symbol("machinen.secret");
const globalSymbol = Symbol.for("machinen.global");
const object = { visible: "machinen-visible-symbol-object-v1" };
object[localSymbol] = "portable-symbol-value";
object[globalSymbol] = 56;
const memoryState = {
  kind: "symbol-keyed-object",
  anchor: "machinen-real-symbol-keyed-object-anchor-v1",
  stringKeys: Object.keys(object),
  symbolProperties: Object.getOwnPropertySymbols(object).map((symbol) => ({
    registry: Symbol.keyFor(symbol) ? "global" : "local",
    description: symbol.description,
    value: object[symbol],
  })),
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-symbol-keyed-object-anchor-v1",
    symbol: "symbol-description:machinen.secret",
    value: "symbol-value:portable-symbol-value",
    globalSymbol: "global-symbol:machinen.global",
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
