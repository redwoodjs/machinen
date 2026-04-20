// Increments a counter every second and writes it to /tmp/count.
// Writing to a file (re-opened each tick) keeps the CRIU surface small:
// no long-lived stdout pipe, no sockets, no tty state.
const fs = require("fs");
let n = 0;
setInterval(() => {
  n++;
  fs.writeFileSync("/tmp/count", String(n) + "\n");
}, 1000);
