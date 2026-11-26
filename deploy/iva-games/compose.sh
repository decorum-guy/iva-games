#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
release_env="${IVA_RELEASE_ENV:-/etc/iva-games/release.env}"
if [[ ! -f "$release_env" ]]; then
  printf 'Missing release configuration: %s\n' "$release_env" >&2
  exit 1
fi
exec docker compose --project-name iva-games --env-file "$release_env" \
  --file "$script_dir/compose.yaml" "$@"
