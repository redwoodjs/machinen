#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
if (cd "$FSROOT" && sha256sum -c /mnt/capture/filesystem-sha256.txt >/tmp/machinen-all3-fs-verify.log 2>&1); then
  FS_OK=true
else
  FS_OK=false
fi
COUNT_GOT=$(sqlite3 "$TARGET/app.db" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$TARGET/app.db" 'select sum(qty) from items;')
if [ "$COUNT_GOT" = "$COUNT" ] && [ "$QTY_SUM_GOT" = "$QTY_SUM" ]; then
  SQLITE_OK=true
else
  SQLITE_OK=false
fi
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
SERVICE_BODY=$(perl -MIO::Socket::INET -e 'my $s=IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>18181,Proto=>"tcp",Timeout=>5) or exit 7; print $s "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"; local $/; my $r=<$s>; $r =~ s/^.*?\r?\n\r?\n//s; $r =~ s/\r?\n$//; print $r;')
if [ "$SERVICE_BODY" = "$EXPECTED_RESPONSE" ]; then
  SERVICE_OK=true
else
  SERVICE_OK=false
fi
NODE_OK=false
NODE_ROWS=0
NODE_KIND=null
if [ -f /mnt/capture/nodejs-memory-ir.json ]; then
  # shellcheck disable=SC1091
  . /tmp/machinen-node-env.sh
  if node <<'NODEVERIFY'
const assert = require('assert/strict');
const fs = require('fs');
(async () => {
  const ir = JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json', 'utf8'));
  const expected = ir.rows[0]?.semanticState ?? {};
  const actual = await fetch('http://127.0.0.1:18182/state').then((res) => res.json());
  assert.deepEqual(actual, expected);
})().catch((error) => { console.error(error); process.exit(1); });
NODEVERIFY
  then
    NODE_OK=true
  fi
  NODE_ROWS=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(ir.rows.length)")
  NODE_KIND=$(node -e "const fs=require('fs'); const ir=JSON.parse(fs.readFileSync('/mnt/capture/nodejs-memory-ir.json','utf8')); console.log(JSON.stringify(ir.kind))")
else
  NODE_OK=true
  NODE_KIND=null
fi
if [ "$FS_OK" = true ] && [ "$SQLITE_OK" = true ] && [ "$SERVICE_OK" = true ] && [ "$NODE_OK" = true ]; then
  ACCEPTED=true
else
  ACCEPTED=false
fi
cat > /tmp/machinen-all3-target-verify.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-verifier",
  "accepted": $ACCEPTED,
  "filesystem": { "accepted": $FS_OK, "files": $(wc -l < /mnt/capture/filesystem-sha256.txt | tr -d ' ') },
  "sqlite": { "accepted": $SQLITE_OK, "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "service": { "accepted": $SERVICE_OK, "status": 200, "body": "$SERVICE_BODY" },
  "nodejsMemory": { "accepted": $NODE_OK, "memoryIrKind": $NODE_KIND, "materializedRows": $NODE_ROWS }
}
JSON
cat /tmp/machinen-all3-target-verify.json
[ "$ACCEPTED" = true ]
