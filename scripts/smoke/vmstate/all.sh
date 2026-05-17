#!/usr/bin/env bash
# Run all vmstate-focused smoke repros (#366).

set -euo pipefail

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

"$DIR/timers.sh"
"$DIR/entropy.sh"
"$DIR/sockets.sh"

echo
echo "all vmstate smoke repros passed"
