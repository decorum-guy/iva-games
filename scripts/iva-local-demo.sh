#!/bin/bash
# Isolated, local-only portal. Its databases and mailbox remain in .runtime.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
state="$root/.runtime/acceptance-demo"
mkdir -p "$state/mail"
chmod 700 "$state" "$state/mail"
case "${1:-status}" in
  start)
    for port in 4310 5175; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
        echo "Port $port is in use; existing processes were left alone." >&2; exit 1
      fi
    done
    test -f "$root/dist-platform/main.js" || { echo 'Run npm run build:foundation first.' >&2; exit 1; }
    cd "$root"
    env NODE_ENV=development PLATFORM_HOST=127.0.0.1 PLATFORM_PORT=4310 PORTAL_ORIGIN=http://127.0.0.1:5175 PLATFORM_DATABASE_PATH="$state/platform.sqlite" PLATFORM_LAB_DATABASE_PATH="$state/lab.sqlite" MAIL_MODE=file MAIL_FILE_DIRECTORY="$state/mail" TELEGRAM_ENABLED=false nohup node "$root/dist-platform/main.js" >"$state/api.log" 2>&1 </dev/null &
    echo $! >"$state/api.pid"
    cd "$root/apps/portal"
    env IVA_PLATFORM_TARGET=http://127.0.0.1:4310 nohup "$root/node_modules/.bin/vite" --host 127.0.0.1 --port 5175 --strictPort >"$state/portal.log" 2>&1 </dev/null &
    echo $! >"$state/portal.pid"
    ready=false
    for attempt in {1..30}; do
      if curl -fsS http://127.0.0.1:5175/ -o /dev/null 2>/dev/null && curl -fsS http://127.0.0.1:5175/api/platform/v1/session -o /dev/null 2>/dev/null; then
        ready=true; break
      fi
      sleep 1
    done
    if [[ "$ready" != true ]]; then
      echo "Startup failed; see logs in $state" >&2
      "$0" stop
      exit 1
    fi
    echo 'Started. Portal: http://127.0.0.1:5175/'
    ;;
  stop)
    for service in portal api; do
      file="$state/$service.pid"
      if [[ -f "$file" ]]; then
        pid="$(cat "$file")"
        command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
        case "$service:$command" in
          portal:*"$root/node_modules/.bin/vite"*|api:*"$root/dist-platform/main.js"*) kill "$pid"; echo "Stopped $service." ;;
          *) echo "No matching $service process; left other processes alone." ;;
        esac
        rm -f "$file"
      fi
    done
    ;;
  status)
    for port in 4310 5175; do lsof -nP -iTCP:"$port" -sTCP:LISTEN || true; done
    ;;
  *) echo "Usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
