#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo "usage: machinen-portable-restore-proof <portable-bundle-dir>" >&2
  exit 2
fi
exec /usr/local/bin/machinen-portable-proof --restore-bundle "$1"
