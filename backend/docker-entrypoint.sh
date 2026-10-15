#!/bin/sh
set -eu
role="${1:-api}"
case "$role" in
  api)
    exec node dist/src/main.js
    ;;
  worker)
    exec node dist/src/worker.js
    ;;
  *)
    echo "unknown role: $role (expected api or worker)" >&2
    exit 1
    ;;
esac
