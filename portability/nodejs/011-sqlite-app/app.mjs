import http from "node:http";
import fs from "node:fs";
const db = JSON.parse(fs.readFileSync(new URL("./sqlite-clean.json", import.meta.url), "utf8"));
const body =
  "machinen-node-portability:sqlite-app:rows=" +
  db.items.length +
  ":sum=" +
  db.items.reduce((n, item) => n + item.qty, 0);
http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(body);
  })
  .listen(process.env.PORT || 3000, "127.0.0.1");
