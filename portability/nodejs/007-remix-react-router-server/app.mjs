import http from "node:http";
http
  .createServer((_req, res) =>
    res.end("machinen-node-portability:remix-react-router-server:minimal-remix-shape"),
  )
  .listen(process.env.PORT || 3000, "127.0.0.1");
