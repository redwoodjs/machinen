#!/bin/sh
# Sanity-check that Claude Code landed in the rootfs and launches.
# M1 of #48: we only verify `claude --version`. An actual session
# (`claude` with an API key + network) is M2.
PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export PATH

echo
echo "=== which claude ==="
which claude || echo "(claude not on PATH)"

echo
echo "=== claude --version ==="
claude --version 2>&1 | head -5

echo
echo "=== node version ==="
node --version

echo
echo "=== done ==="
sleep 2
