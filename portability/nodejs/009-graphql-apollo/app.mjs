import http from "node:http";
http
  .createServer((_req, res) =>
    res.end(JSON.stringify({ data: { portability: "machinen-node-portability:graphql-apollo" } })),
  )
  .listen(process.env.PORT || 3000, "127.0.0.1");
