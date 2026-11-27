#!/bin/bash
# macOS launchd owns only this worktree's loopback demonstration.
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
state="$root/.runtime/district-territorial-demo"
id="$(printf '%s' "$root" | cksum | awk '{print $1}')"
job="com.ivagames.district.territorial.$id"
port=4380
origin="http://127.0.0.1:$port"
node="$(command -v node)"
mkdir -p "$state/mail"
case "${1:-status}" in
  start)
    if ! launchctl list "$job" >/dev/null 2>&1; then
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
        echo "Port $port is occupied." >&2; exit 1
      fi
      test -f "$root/dist-platform/main.js" && test -f "$root/apps/portal/dist/index.html" ||
        { echo 'Run npm run build:foundation first.' >&2; exit 1; }
      launchctl submit -l "$job" -o "$state/server.log" -e "$state/server.log" -- /usr/bin/env \
        NODE_ENV=development PLATFORM_HOST=127.0.0.1 PLATFORM_PORT="$port" PORTAL_ORIGIN="$origin" \
        PLATFORM_DATABASE_PATH="$state/platform.sqlite" PLATFORM_LAB_DATABASE_PATH="$state/runtime.sqlite" \
        PORTAL_DIST_DIRECTORY="$root/apps/portal/dist" MAIL_MODE=file MAIL_FILE_DIRECTORY="$state/mail" \
        TELEGRAM_ENABLED=false TELEGRAM_AUTH_ENABLED=false \
        "$node" "$root/dist-platform/main.js"
    fi
    for attempt in {1..20}; do
      if curl -fsS "$origin/health/ready" -o /dev/null 2>/dev/null; then
        "$node" "$root/scripts/district-territorial-demo.mjs" prepare "$origin" "$state"
        exit 0
      fi
      sleep 1
    done
    echo "Startup failed. See $state/server.log" >&2; exit 1
    ;;
  open)
    if launchctl list "$job.browser" >/dev/null 2>&1; then launchctl remove "$job.browser"; fi
    launchctl submit -l "$job.browser" -o "$state/browser.log" -e "$state/browser.log" -- "$node" \
      "$root/scripts/district-territorial-demo.mjs" open "$origin" "$state"
    ;;
  stop)
    if launchctl list "$job.browser" >/dev/null 2>&1; then launchctl remove "$job.browser"; fi
    if launchctl list "$job" >/dev/null 2>&1; then launchctl remove "$job"; fi
    ;;
  status)
    launchctl list "$job" | grep -E '"(Label|PID|LastExitStatus)"'
    curl -fsS "$origin/health/ready"
    echo
    ;;
  *) echo "Usage: $0 {start|open|stop|status}" >&2; exit 2 ;;
esac
