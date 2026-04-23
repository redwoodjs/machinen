import { createServer } from "node:http";

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from microvm\n");
});

server.listen(3000, "0.0.0.0", () => {
  console.log("node-http: listening on 0.0.0.0:3000");
});
