import http from "node:http";
const anchors = {
  scalar: "machinen-memory-category-scalar-v1",
  string: "machinen-memory-category-string-v1",
  object: "machinen-memory-category-object-v1",
  array: "machinen-memory-category-array-v1",
  closure: "machinen-memory-category-closure-v1",
  buffer: "machinen-memory-category-buffer-v1",
  typedArray: "machinen-memory-category-typed-array-v1",
  pendingPromise: "machinen-memory-category-pending-promise-v1",
};
let count = 41;
const state = {
  scalarAnchor: anchors.scalar,
  stringValue: anchors.string,
  objectValue: { anchor: anchors.object, total: 2, nested: { label: "demo" } },
  arrayValue: [anchors.array, 1, 2],
  bufferValue: Buffer.from(anchors.buffer),
  typedArrayValue: new Uint32Array([0x6d616368, 0x696e656e]),
};
state.typedArrayAnchor = anchors.typedArray;
const closureCounter = (() => {
  const anchor = anchors.closure;
  let local = count;
  return () => ({ anchor, local });
})();
const pending = new Promise(() => undefined);
globalThis.__machinenMemoryClassifierState = { anchors, state, closureCounter, pending };
setInterval(() => {
  globalThis.__machinenMemoryClassifierState.closureCounter();
}, 1000);
http
  .createServer((req, res) => {
    if (req.url === "/state") {
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1");
