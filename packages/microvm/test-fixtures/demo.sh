#!/bin/sh
# Minimal interactive-input test.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

echo ""
echo "=== machinen-microvm — interactive test ==="
echo "type something; enter sends the line."
echo ""

# Use node as the REPL. It reads process.stdin line by line,
# echoes it back, and keeps going. Exits cleanly on 'quit'.
exec /usr/local/bin/node -e '
process.stdout.write("node repl started on /dev/console\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  const line = d.replace(/\n$/, "");
  process.stdout.write("you typed: " + line + "\n");
  if (line === "quit") process.exit(0);
});
process.stdin.on("end", () => process.exit(0));
'
