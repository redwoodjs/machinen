import http from "node:http";
const buffer = new ArrayBuffer(8);
const bytes = new Uint8Array(buffer);
bytes.set([3, 1, 4, 1, 5, 9, 2, 6]);
const numberBuffer = new ArrayBuffer(4);
const numberView = new DataView(numberBuffer);
numberView.setFloat32(0, 3.5, true);
const view = new DataView(buffer);
const memoryState = {
  kind: "arraybuffer-dataview",
  anchor: "machinen-real-arraybuffer-dataview-anchor-v1",
  byteLength: buffer.byteLength,
  bytes: [...new Uint8Array(buffer)],
  uint16beAt0: view.getUint16(0, false),
  float32leAt0: numberView.getFloat32(0, true),
};
globalThis.__machinenRealMemoryState = {
  memoryState,
  anchors: {
    anchor: "machinen-real-arraybuffer-dataview-anchor-v1",
    bytes: "arraybuffer-bytes:3,1,4,1,5,9,2,6",
    uint16: "dataview-uint16be:769",
    float32: "dataview-float32:3.5",
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
