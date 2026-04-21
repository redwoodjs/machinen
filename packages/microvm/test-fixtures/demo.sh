#!/bin/sh
# Entry script for try.sh's CRIU demo. Pointed at via
# machinen-config.json { "cmd": ["/bin/sh", "/demo.sh"] } (try.sh
# handles the config). Just execs fork-demo.sh — the CRIU flow
# itself lives there.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH
exec /bin/sh /fork-demo.sh
