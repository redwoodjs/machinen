#!/bin/sh
# demo.sh — picked up by our tiny /init as PID 1's real payload. Swap
# in whatever you want the guest to run.
#
# Current demo: freeze a running Node counter with CRIU, then restart
# it from the dump. Proves the machinen hot-move primitive.
#
# For an interactive Node REPL instead, replace the body below with:
#     exec /usr/local/bin/node
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH
exec /bin/sh /fork-demo.sh
