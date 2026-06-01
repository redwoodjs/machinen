import { createServer } from "node:http";

const activeMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 97, 99, 116, 105, 118,
  101, 45, 104, 116, 116, 112, 45, 114, 101, 113, 117, 101, 115, 116, 45, 108, 105, 118, 101, 45,
  118, 49,
];
const partialSocketMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 112, 97, 114, 116, 105,
  97, 108, 45, 115, 111, 99, 107, 101, 116, 45, 108, 105, 118, 101, 45, 118, 49,
];
const listenerMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 108, 105, 98, 117, 118,
  45, 116, 99, 112, 45, 108, 105, 115, 116, 101, 110, 101, 114, 45, 118, 49,
];
const timerMarkerBytes = [
  109, 97, 99, 104, 105, 110, 101, 110, 45, 108, 101, 118, 101, 108, 53, 45, 108, 105, 98, 117, 118,
  45, 114, 101, 112, 101, 97, 116, 105, 110, 103, 45, 116, 105, 109, 101, 114, 45, 118, 49,
];

function text(bytes) {
  return String.fromCharCode(...bytes);
}

function makeHandler() {
  const machinenLevel5ContextAnchor = "machinen-level5-v8-context-anchor-v1";
  const listenerMarker = text(listenerMarkerBytes);
  const timerMarker = text(timerMarkerBytes);
  let count = 0;
  let timerTicks = 0;
  globalThis.machinenLibuvResourceFixture = {
    listener: { marker: listenerMarker, host: "127.0.0.1", port: 3000, protocol: "tcp" },
    timer: { marker: timerMarker, repeatMs: 100, ticks: () => timerTicks },
  };
  setInterval(() => {
    timerTicks += 1;
  }, 100).unref();

  return function machinenNativeLibuvResourceHandler(req, res) {
    if (
      machinenLevel5ContextAnchor.length === 0 ||
      listenerMarker.length === 0 ||
      timerMarker.length === 0
    ) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url === "/state" || req.url === "/timer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ count, timerTicks, listenerOpen: true, timerRepeatMs: 100 }) + "\n");
      return;
    }
    if (req.url === "/hold") {
      const activeMarker = text(activeMarkerBytes);
      globalThis[activeMarker] = true;
      globalThis.machinenActiveHttpRequest = {
        marker: activeMarker,
        markerBytes: Buffer.from(activeMarkerBytes),
        startedAt: Date.now(),
      };
      setTimeout(() => {
        delete globalThis[activeMarker];
        globalThis.machinenActiveHttpRequest = undefined;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("released\n");
      }, 30000);
      return;
    }
    if (req.url === "/partial-socket") {
      const partialMarker = text(partialSocketMarkerBytes);
      globalThis[partialMarker] = true;
      globalThis.machinenPartialSocketState = {
        marker: partialMarker,
        markerBytes: Buffer.from(partialSocketMarkerBytes),
        unreadBytesModeled: true,
        startedAt: Date.now(),
      };
      setTimeout(() => {
        delete globalThis[partialMarker];
        globalThis.machinenPartialSocketState = undefined;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("partial-released\n");
      }, 30000);
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ count: ++count, timerTicks, listenerOpen: true, timerRepeatMs: 100 }) + "\n",
    );
  };
}

createServer(makeHandler()).listen(3000, "127.0.0.1");
