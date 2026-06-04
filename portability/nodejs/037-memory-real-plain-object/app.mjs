import http from "node:http";

const objectState = {
  anchor: "machinen-real-plain-object-anchor-v1",
  kind: "machinen-real-plain-object-kind-v1",
  message: "machinen-real-plain-object-message-v1",
  countLabel: "count:7",
  nestedLabel: "nested:portable",
};

globalThis.__machinenRealPlainObjectState = objectState;

setInterval(() => {
  void globalThis.__machinenRealPlainObjectState.anchor;
}, 1000);

http
  .createServer((req, res) => {
    if (req.url === "/value") {
      res.end("plain-object-ready");
      return;
    }
    if (req.url === "/state") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(objectState));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(3000, "127.0.0.1");
