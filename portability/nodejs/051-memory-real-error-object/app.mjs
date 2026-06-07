import http from "node:http";

const cause = new TypeError("machinen-error-cause-message-v1");
const error = new Error("machinen-error-message-v1", { cause });
error.name = "MachinenPortableError";
error.code = "MACHINEN_PORTABLE_ERROR";
const memoryState = {
  kind: "error-object",
  anchor: "machinen-real-error-object-anchor-v1",
  name: error.name,
  message: error.message,
  code: error.code,
  causeName: cause.name,
  causeMessage: cause.message,
};
globalThis.__machinenRealMemoryState = {
  error,
  memoryState,
  anchors: {
    anchor: "machinen-real-error-object-anchor-v1",
    name: "error-name:MachinenPortableError",
    message: "error-message:machinen-error-message-v1",
    code: "error-code:MACHINEN_PORTABLE_ERROR",
    cause: "error-cause:machinen-error-cause-message-v1",
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
