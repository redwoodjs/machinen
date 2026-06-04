import http from "node:http";
import fs from "node:fs";
const text = fs.readFileSync(new URL("./public/message.txt", import.meta.url), "utf8").trim();
http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("machinen-node-portability:static-file-server:" + text);
  })
  .listen(process.env.PORT || 3000, "127.0.0.1");
