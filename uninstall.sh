#!/usr/bin/env bash
set -euo pipefail
lecture_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "${lecture_dir}/scripts/uninstall.sh" "$@"
