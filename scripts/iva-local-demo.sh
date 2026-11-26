#!/bin/bash
# Isolated, local-only portal. Databases and mailbox remain in .runtime.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
state="$root/.runtime/acceptance-demo"
job_id="$(printf '%s' "$root" | cksum | awk '{print $1}')"
api_job="com.ivagames.platform.local.${job_id}.api"
portal_job="com.ivagames.platform.local.${job_id}.portal"
mkdir -p "$state/mail"
chmod 700 "$state" "$state/mail"
case "${1:-status}" in
  start)
    for job in "$api_job" "$portal_job"; do
      if launchctl list "$job" >/dev/null 2>&1; then
        echo "Demo job $job already exists; run status or stop first." >&2; exit 1
      fi
    done
    for port in 4310 5175; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
        echo "Port $port is in use; existing processes were left alone." >&2; exit 1
      fi
    done
    test -f "$root/dist-platform/main.js" || { echo 'Run npm run build:foundation first.' >&2; exit 1; }
    test -f "$root/node_modules/vite/bin/vite.js" || { echo 'Run npm ci first.' >&2; exit 1; }
    node_path="$(command -v node)"
    # Launchd owns these jobs, so closing the initiating terminal does not stop them.
    launchctl submit -l "$api_job" -o "$state/api.log" -e "$state/api.log" -- /usr/bin/env NODE_ENV=development PLATFORM_HOST=127.0.0.1 PLATFORM_PORT=4310 PORTAL_ORIGIN=http://127.0.0.1:5175 PLATFORM_DATABASE_PATH="$state/platform.sqlite" PLATFORM_LAB_DATABASE_PATH="$state/lab.sqlite" MAIL_MODE=file MAIL_FILE_DIRECTORY="$state/mail" TELEGRAM_ENABLED=false "$node_path" "$root/dist-platform/main.js"
    if ! launchctl submit -l "$portal_job" -o "$state/portal.log" -e "$state/portal.log" -- /usr/bin/env IVA_PLATFORM_TARGET=http://127.0.0.1:4310 "$node_path" "$root/node_modules/vite/bin/vite.js" "$root/apps/portal" --host 127.0.0.1 --port 5175 --strictPort; then
      launchctl remove "$api_job"; exit 1
    fi
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
    for job in "$portal_job" "$api_job"; do
      if launchctl list "$job" >/dev/null 2>&1; then
        launchctl remove "$job"
        echo "Stopped $job."
      fi
    done
    ;;
  status)
    for job in "$api_job" "$portal_job"; do
      if launchctl list "$job" >/dev/null 2>&1; then launchctl list "$job" | grep -E '"(Label|PID|LastExitStatus)"'; else echo "$job: not running"; fi
    done
    for port in 4310 5175; do lsof -nP -iTCP:"$port" -sTCP:LISTEN || true; done
    ;;
  *) echo "Usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
