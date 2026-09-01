#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "${MEOO_WORKDIR:-$ROOT_DIR}"
chmod +x scripts/start.sh
