import http from "node:http";
import fs from "node:fs";
fs.mkdirSync(new URL("./uploads/", import.meta.url), { recursive: true });
http
  .createServer((req, res) => {
    if (req.method === "POST") {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        fs.writeFileSync(new URL("./uploads/latest.txt", import.meta.url), data);
        res.end("machinen-node-portability:file-upload-app:uploaded=" + data.length);
      });
      return;
    }
    res.end("machinen-node-portability:file-upload-app");
  })
  .listen(process.env.PORT || 3000, "127.0.0.1");
