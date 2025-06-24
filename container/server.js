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
    let requestBodyChunks = [];
    req.on("data", (chunk) => {
      requestBodyChunks.push(chunk);
    });

    req.on("end", () => {
      const rawBody = Buffer.concat(requestBodyChunks).toString();
      
      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ message: "Bad Request: Invalid JSON" }));
      }

      if (!parsedBody || typeof parsedBody.content === "undefined") {
        res.writeHead(400);
        return res.end(JSON.stringify({ message: "Bad Request: Missing content in body" }));
      }

      try {
        fs.writeFileSync(path.join(PROJECT_PATH, pathname), parsedBody.content);
        res.writeHead(200);
        return res.end(JSON.stringify({ message: "File saved successfully" }));
      } catch (error) {
        res.writeHead(500);
        return res.end(JSON.stringify({ message: "Internal Server Error: Could not save file" }));
      }
    });
    return;
  }
  // return res.end(JSON.stringify({ message: "Bad Request: Invalid action" }));

  // if (pathname === "/files" && req.method === "GET") {
  //   // path is required
  //   if (!query.path) {
  //     res.writeHead(400);
  //     res.end(
  //       JSON.stringify({ message: "Bad Request: Missing path query parameter" })
  //     );
  //     return;
  //   }

  //   // path must be a valid path, in that it must be relative to the initial directory
  //   const resolvedPath = path.join(INITIAL_DIR, query.path);
  //   if (!resolvedPath.startsWith(INITIAL_DIR)) {
  //     res.writeHead(403);
  //     res.end(JSON.stringify({ message: "Forbidden: Access denied." }));
  //     return;
  //   }

  //   // path must be a directory
  //   if (!fs.statSync(resolvedPath).isDirectory()) {
  //     res.writeHead(400);
  //     res.end(
  //       JSON.stringify({ message: "Bad Request: Path is not a directory" })
  //     );
  //     return;
  //   }

  //   let relativePath = path.relative(INITIAL_DIR, resolvedPath);
  //   if (!relativePath.startsWith("/")) {
  //     relativePath = "/" + relativePath;
  //   }
  //   if (!relativePath.endsWith("/")) {
  //     relativePath = relativePath + "/";
  //   }

  //   // only fetch the files in this resolve path.
  //   const files = fs.readdirSync(resolvedPath, { withFileTypes: true });
  //   const fileList = files.map((file) => {
  //     return {
  //       path: relativePath,
  //       name: file.name,
  //       type: file.isDirectory() ? "directory" : "file",
  //     };
  //   });
  //   res.writeHead(200);
  //   res.end(JSON.stringify(fileList));
  //   return;
  // } else if (pathname === "/file" && req.method === "GET") {
  //   if (!query.path) {
  //     res.writeHead(400);
  //     res.end(
  //       JSON.stringify({ message: "Bad Request: Missing path query parameter" })
  //     );
  //     return;
  //   }

  //   const resolvedPath = path.join(INITIAL_DIR, query.path);
  //   if (!resolvedPath.startsWith(INITIAL_DIR)) {
  //     res.writeHead(403);
  //     res.end(JSON.stringify({ message: "Forbidden: Access denied." }));
  //     return;
  //   }

  //   // does the file exist?
  //   if (!fs.existsSync(resolvedPath)) {
  //     res.writeHead(404);
  //     res.end(JSON.stringify({ message: "Not Found: File does not exist" }));
  //     return;
  //   }

  //   const file = fs.readFileSync(resolvedPath, "utf8");
  //   res.writeHead(200);
  //   res.end(JSON.stringify({ file }));
  //   return;
  // } else if (pathname === "/file" && req.method === "POST") {
  //   console.log("POST /file");

  //   if (!query.path) {
  //     console.log("Missing path query parameter");
  //     res.writeHead(400);
  //     res.end(
  //       JSON.stringify({ message: "Bad Request: Missing path query parameter" })
  //     );
  //     return;
  //   }

  //   let requestBodyChunks = [];
  //   req.on("data", (chunk) => {
  //     requestBodyChunks.push(chunk);
  //   });

  //   req.on("end", () => {
  //     const rawBody = Buffer.concat(requestBodyChunks).toString();

  //     console.log("---- POST /file ----");
  //     console.log("Path:", query.path);
  //     console.log("Headers:", req.headers);
  //     console.log("Raw Body:", rawBody);
  //     console.log("----------------------");

  //     let parsedBody;
  //     if (rawBody) {
  //       try {
  //         parsedBody = JSON.parse(rawBody);
  //       } catch (e) {
  //         console.log("Invalid JSON", e);
  //         res.writeHead(400);
  //         res.end(JSON.stringify({ message: "Bad Request: Invalid JSON" }));
  //         return;
  //       }
  //     } else {
  //       console.log("Missing body");
  //       res.writeHead(400);
  //       res.end(JSON.stringify({ message: "Bad Request: Missing body" }));
  //       return;
  //     }

  //     // Ensure content exists in the parsed body
  //     if (!parsedBody || typeof parsedBody.content === "undefined") {
  //       console.log("Missing content in body");
  //       res.writeHead(400);
  //       res.end(
  //         JSON.stringify({ message: "Bad Request: Missing content in body" })
  //       );
  //       return;
  //     }

  //     const resolvedPath = path.join(INITIAL_DIR, query.path);
  //     if (!resolvedPath.startsWith(INITIAL_DIR)) {
  //       console.log("Forbidden: Access denied.");
  //       res.writeHead(403);
  //       res.end(JSON.stringify({ message: "Forbidden: Access denied." }));
  //       return;
  //     }

  //     try {
  //       fs.writeFileSync(resolvedPath, parsedBody.content);
  //       console.log("File saved successfully", resolvedPath);
  //       res.writeHead(200);
  //       res.end(JSON.stringify({ message: "File saved successfully" }));
  //     } catch (error) {
  //       console.error("Error writing file:", error);
  //       res.writeHead(500);
  //       res.end(
  //         JSON.stringify({
  //           message: "Internal Server Error: Could not save file",
  //         })
  //       );
  //     }
  //   });
  // } else if (pathname === "/file-type" && req.method === "GET") {
  //   if (!query.path) {
  //     res.writeHead(400);
  //     res.end(
  //       JSON.stringify({ message: "Bad Request: Missing path query parameter" })
  //     );
  //     return;
  //   }

  //   const resolvedPath = path.join(INITIAL_DIR, query.path);
  //   if (!resolvedPath.startsWith(INITIAL_DIR)) {
  //     res.writeHead(403);
  //     res.end(JSON.stringify({ message: "Forbidden: Access denied." }));
  //     return;
  //   }

  //   let fileType = "file";

  //   try {
  //     fileType = fs.statSync(resolvedPath).isDirectory() ? "directory" : "file";
  //   } catch (e) {
  //     console.log("Error getting file type", e);
  //     res.writeHead(500);
  //     res.end(JSON.stringify({ message: "Internal Server Error" }));
  //     return;
  //   }

  //   res.writeHead(200);
  //   res.end(JSON.stringify({ fileType }));
  //   return;
  // }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
