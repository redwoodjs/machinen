import http from "node:http";
const schedule = "interval:declared:1000ms";
http
  .createServer((_req, res) => {
    res.end("machinen-node-portability:cron-timer-app:" + schedule);
  })
  .listen(process.env.PORT || 3000, "127.0.0.1");
