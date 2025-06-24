import http from "http";
import fs from "fs";
import path from "path";
import { parse } from "url";

const PORT = 8911;
const PROJECT_PATH = process.cwd();

const server = http.createServer(async (req, res) => {
  const query = parse(req.url, true).query;
  const pathname = query.pathname;
  const action = query.action;
  if (!pathname || !action) {
    res.writeHead(400);
    return res.end(
      JSON.stringify({ message: "Bad Request: Missing pathname or action" })
    );
  }

  console.log("pathname", pathname, "action", action);

  res.setHeader("Content-Type", "application/json");

  if (action === "LIST") {
    let absPath = path.join(PROJECT_PATH, pathname);
    if (!fs.statSync(absPath).isDirectory()) {
      // pop off the filename part of the absPath
      absPath = path.dirname(absPath);
    }

    const files = fs.readdirSync(absPath, {
      withFileTypes: true,
    });
    const fileList = files.map((file) => {
      return {
        path:
          "/editor" +
          path.join(file.parentPath, file.name).slice(PROJECT_PATH.length),
        name: file.name,
        type: file.isDirectory() ? "directory" : "file",
      };
    });
    res.writeHead(200);
    return res.end(JSON.stringify(fileList));
  }

  if (action === "TYPE") {
    const type = fs.statSync(path.join(PROJECT_PATH, pathname)).isDirectory()
      ? "directory"
      : "file";
    res.writeHead(200);
    return res.end(JSON.stringify({ type }));
  }

  if (action === "READ") {
    const content = fs.readFileSync(path.join(PROJECT_PATH, pathname), "utf8");
    res.writeHead(200);
    return res.end(JSON.stringify({ content }));
  }

  if (action === "WRITE") {
    // must be a post
    if (req.method !== "POST") {
      res.writeHead(400);
      return res.end(
        JSON.stringify({ message: "Bad Request: Must be a POST" })
      );
    }

    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const data = Buffer.concat(chunks).toString("utf8");
      const file = JSON.parse(data);
      fs.writeFileSync(path.join(PROJECT_PATH, pathname), file.content, "utf8");
    });

    res.writeHead(200);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
