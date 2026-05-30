import { createServer } from "node:http";

function makeTimerState() {
  const machinenLevel5TimerAnchor = "machinen-level5-libuv-timer-anchor-v1";
  let timerTicks = 0;
  const interval = setInterval(function machinenTimerCallback() {
    if (machinenLevel5TimerAnchor.length === 0) {
      throw new Error("unreachable timer anchor guard");
    }
    timerTicks++;
  }, 100);
  return {
    interval,
    get ticks() {
      if (machinenLevel5TimerAnchor.length === 0) {
        throw new Error("unreachable timer read guard");
      }
      return timerTicks;
    },
  };
}

const timerState = makeTimerState();

function makeHandler() {
  const machinenLevel5ContextAnchor = "machinen-level5-v8-context-anchor-v1";
  let count = 0;
  return function machinenCounterHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0) {
      throw new Error("unreachable anchor guard");
    }
    if (req.url === "/timer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ timerTicks: timerState.ticks }) + "\n");
      return;
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
createServer(makeHandler()).listen(3000, "127.0.0.1");
