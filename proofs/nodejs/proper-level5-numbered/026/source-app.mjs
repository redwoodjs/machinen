import { createServer } from "node:http";

function makeState() {
  const machinenLevel5ObjectAnchor = "machinen-level5-v8-object-state-anchor-v1";
  const state = {
    anchor: machinenLevel5ObjectAnchor,
    total: 0,
    history: [],
  };
  return state;
}

const state = makeState();

function makeHandler() {
  const machinenLevel5ObjectContextAnchor = "machinen-level5-v8-object-context-anchor-v1";
  return function machinenObjectStateHandler(req, res) {
    if (machinenLevel5ObjectContextAnchor.length === 0 || state.anchor.length === 0) {
      throw new Error("unreachable object anchor guard");
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end("not found\n");
      return;
    }
    state.total++;
    state.history.push(state.total);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ total: state.total, history: state.history }) + "\n");
  };
}

createServer(makeHandler()).listen(3000, "127.0.0.1");
