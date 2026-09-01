#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${MEOO_WORKDIR:-$ROOT_DIR}"
exec python3 server.py --host 0.0.0.0 --port "${PORT:-9000}"
