import http from "node:http";
http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("machinen-node-portability:native-addon-app");
  })
  .listen(process.env.PORT || 3000, "127.0.0.1");
