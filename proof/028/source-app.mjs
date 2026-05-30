import { createServer } from "node:http";

function makeHandler() {
  const machinenLevel5ContextAnchor = "machinen-level5-v8-context-anchor-v1";
  let count = 0;
  return function machinenCrossArchCounterHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: ++count }) + "\n");
  };
}

const server = createServer(makeHandler());
server.listen(3000, "127.0.0.1");
