#!/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

echo ""
echo "=== machinen-microvm — interactive Node REPL ==="
echo "(type something, enter sends; 'quit' exits)"
echo ""

ls /dev/ttyAMA* /dev/console 2>&1 | head -3
echo ""

exec /usr/local/bin/node -e '
process.stdout.write("node repl ready\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  const line = d.replace(/\n$/, "");
  process.stdout.write("you typed: " + line + "\n");
  if (line === "quit") process.exit(0);
});
process.stdin.on("end", () => process.exit(0));
'
