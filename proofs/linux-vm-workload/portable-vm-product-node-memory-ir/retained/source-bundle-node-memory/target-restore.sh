#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
mkdir -p "$TARGET"
rm -rf "$FSROOT"
mkdir -p "$FSROOT"
cp -a /mnt/capture/filesystem/root/. "$FSROOT/"
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update >/tmp/machinen-all3-apt-update.log 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sqlite3 >/tmp/machinen-all3-apt-install.log 2>&1
fi
DB="$TARGET/app.db"
rm -f "$DB"
sqlite3 "$DB" < /mnt/capture/sqlite-dump.sql
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
COUNT_GOT=$(sqlite3 "$DB" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$DB" 'select sum(qty) from items;')
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
cat > "$TARGET/service.pl" <<'PL'
use strict;
use warnings;
use IO::Socket::INET;
my $port = $ENV{MACHINEN_ALL3_SERVICE_PORT} || 18181;
my $body = ($ENV{MACHINEN_ALL3_SERVICE_RESPONSE} || 'machinen-portable-service-v1') . "\n";
my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp', Listen => 16, Reuse => 1) or die "listen: $!\n";
$SIG{TERM} = sub { exit 0; };
while (my $client = $server->accept()) {
  my $buf = '';
  sysread($client, $buf, 4096);
  print $client "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n" . $body;
  close($client);
}
PL
rm -f /tmp/machinen-all3-service.log /tmp/machinen-all3-service.pid
MACHINEN_ALL3_SERVICE_PORT=18181 MACHINEN_ALL3_SERVICE_RESPONSE="$EXPECTED_RESPONSE" perl "$TARGET/service.pl" >/tmp/machinen-all3-service.log 2>&1 &
echo $! >/tmp/machinen-all3-service.pid
NODE_MEMORY_MATERIALIZED=false
NODE_MEMORY_ROWS=0
NODE_MEMORY_PID=0
NODE_RESOURCE_MATERIALIZED=false
NODE_RESOURCE_ROWS=0
NODE_RESOURCE_PID=0
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  cat >/tmp/machinen-node-env.sh <<'NODEENV'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=sh)"
  fnm use 22.13.1 >/dev/null 2>&1 || fnm install 22.13.1 >/dev/null 2>&1 || true
  eval "$(fnm env --shell=sh)"
fi
NODEENV
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if ! command -v node >/dev/null 2>&1; then
    apt-get update >/tmp/machinen-node-apt-update.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/tmp/machinen-node-apt-install.log 2>&1
  fi
  node /mnt/capture/nodejs-memory-materializer.mjs --ir /mnt/capture/nodejs-memory-ir.json --target-dir "$TARGET" --port 18182 >/tmp/machinen-node-memory-materializer.json
  rm -f /tmp/machinen-node-memory.log /tmp/machinen-node-memory.pid
  node "$TARGET/node-memory-app.mjs" >/tmp/machinen-node-memory.log 2>&1 &
  NODE_MEMORY_PID=$!
  echo "$NODE_MEMORY_PID" >/tmp/machinen-node-memory.pid
  NODE_MEMORY_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_MEMORY_MATERIALIZED=true
fi
if [ -f /mnt/capture/nodejs-resource-ir.json ]; then
  if [ ! -f /tmp/machinen-node-env.sh ]; then
    cat >/tmp/machinen-node-env.sh <<'NODEENV'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=sh)"
  fnm use 22.13.1 >/dev/null 2>&1 || fnm install 22.13.1 >/dev/null 2>&1 || true
  eval "$(fnm env --shell=sh)"
fi
NODEENV
  fi
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if ! command -v node >/dev/null 2>&1; then
    apt-get update >/tmp/machinen-node-resource-apt-update.log 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/tmp/machinen-node-resource-apt-install.log 2>&1
  fi
  node /mnt/capture/nodejs-resource-materializer.mjs --ir /mnt/capture/nodejs-resource-ir.json --target-dir "$TARGET" --port 18183 >/tmp/machinen-node-resource-materializer.json
  rm -f /tmp/machinen-node-resource.log /tmp/machinen-node-resource.pid
  node "$TARGET/node-resource-app.mjs" >/tmp/machinen-node-resource.log 2>&1 &
  NODE_RESOURCE_PID=$!
  echo "$NODE_RESOURCE_PID" >/tmp/machinen-node-resource.pid
  NODE_RESOURCE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-resource-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_RESOURCE_MATERIALIZED=true
fi
cat > /tmp/machinen-all3-target-restore.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-restore",
  "accepted": true,
  "filesystemRestored": true,
  "sqliteRestored": { "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "sqliteExpected": { "count": $COUNT, "qtySum": $QTY_SUM },
  "serviceStarted": true,
  "servicePid": $(cat /tmp/machinen-all3-service.pid),
  "nodejsMemory": { "materialized": $NODE_MEMORY_MATERIALIZED, "materializedRows": $NODE_MEMORY_ROWS, "pid": $NODE_MEMORY_PID },
  "nodejsResource": { "materialized": $NODE_RESOURCE_MATERIALIZED, "materializedRows": $NODE_RESOURCE_ROWS, "pid": $NODE_RESOURCE_PID }
}
JSON
cat /tmp/machinen-all3-target-restore.json
