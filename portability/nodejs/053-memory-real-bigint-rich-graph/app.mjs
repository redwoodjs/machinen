import http from "node:http";

const primary = 900719925474099312345n;
const nested = 18446744073709551615n;
const values = [1n, 2n, 340282366920938463463374607431768211455n];
const graph = {
  label: "machinen-bigint-rich-graph-label-v1",
  primary,
  nested: { amount: nested },
  values,
};
const memoryState = {
  kind: "bigint-rich-graph",
  anchor: "machinen-real-bigint-rich-graph-anchor-v1",
  label: graph.label,
  primary: { type: "BigInt", decimal: primary.toString() },
  nested: { amount: { type: "BigInt", decimal: nested.toString() } },
  values: values.map((value) => ({ type: "BigInt", decimal: value.toString() })),
};
globalThis.__machinenRealMemoryState = {
  graph,
  memoryState,
  anchors: {
    anchor: "machinen-real-bigint-rich-graph-anchor-v1",
    primary: "bigint-primary:900719925474099312345",
    nested: "bigint-nested:18446744073709551615",
    array: "bigint-array:1,2,340282366920938463463374607431768211455",
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
