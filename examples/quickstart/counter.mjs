// counter.mjs

import { createServer } from "node:http";

let count = 0;

createServer((_, res) => {
  res.end(JSON.stringify({ count: ++count }) + "\n");
}).listen(3000);
