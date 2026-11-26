#!/usr/bin/env bash
# Briefly stop ONE application, copy its entire /data, verify SQLite, restart it.
# No live WAL copy and no automatic restore. The other application stays up.
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
service="${1:-}"
destination="${2:-}"
if [[ "$service" != chess && "$service" != platform ]] || [[ "$destination" != /* ]] || [[ -e "$destination" ]]; then
  printf 'Usage: backup.sh chess|platform /absolute/new/backup-directory\n' >&2
  exit 1
fi
container_id="$("$script_dir/compose.sh" ps --all --quiet "$service")"
if [[ -z "$container_id" || "$container_id" == *$'\n'* ]]; then
  printf 'Expected exactly one existing %s container.\n' "$service" >&2
  exit 1
fi
image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
was_running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
restart_needed=false
restart_original() {
  local result=$?
  trap - EXIT
  if [[ "$restart_needed" == true ]]; then
    if ! docker start "$container_id" >/dev/null; then
      printf 'Could not restart %s; start this original container manually.\n' "$service" >&2
      result=1
    fi
  fi
  exit "$result"
}
trap restart_original EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 -- "$destination"
touch "$destination/INCOMPLETE"
printf '%s\n' "$service" > "$destination/service.txt"
printf '%s\n' "$image_id" > "$destination/image-id.txt"
docker inspect --format '{{.Config.Image}}' "$container_id" > "$destination/image-reference.txt"
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container_id" > "$destination/revision.txt"

if [[ "$was_running" == true ]]; then
  restart_needed=true
  "$script_dir/compose.sh" stop --timeout 60 "$service"
  if [[ "$(docker inspect --format '{{.State.ExitCode}}' "$container_id")" != 0 ]]; then
    printf 'Shutdown was not clean; backup rejected. Check the service before retrying.\n' >&2
    exit 1
  fi
fi
mkdir -m 700 "$destination/data"
docker cp "$container_id:/data/." "$destination/data/"

# Open a private disposable copy, leaving the saved directory read-only.
# Use the exact original image so the SQLite binding matches the application.
docker run --rm --interactive --network none --user 0:0 \
  --mount "type=bind,src=$destination/data,dst=/backup,readonly" \
  --entrypoint node "$image_id" --input-type=module - "$service" <<'NODE'
import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import Database from 'better-sqlite3';
const directory = mkdtempSync('/tmp/iva-backup-check-');
cpSync('/backup', directory, { recursive: true });
const names = process.argv[2] === 'chess'
  ? ['remorse.sqlite', 'overdrive.sqlite']
  : ['platform.sqlite', 'platform-lab.sqlite'];
// Keep older two-game images backup-compatible; copy/verify Colossus when present.
if (process.argv[2] === 'chess' && existsSync(`${directory}/colossus.sqlite`)) names.push('colossus.sqlite');
for (const name of names) {
  const database = new Database(`${directory}/${name}`, { fileMustExist: true });
  try {
    const rows = database.pragma('quick_check');
    if (rows.length !== 1 || rows[0].quick_check !== 'ok') throw new Error(`Invalid SQLite backup: ${name}`);
  } finally { database.close(); }
}
console.log(`${names.length} SQLite databases passed quick_check.`);
NODE

rm "$destination/INCOMPLETE"
printf 'Verified %s backup: %s\n' "$service" "$destination"
