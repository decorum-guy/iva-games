#!/usr/bin/env bash
# Per-service inputs plus the schema/protocol compatibility boundary. Read the
# Git index, matching the immutable, clean checkout used by the release job.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec python3 -B deploy/iva-games/image-inputs.py "$@"
