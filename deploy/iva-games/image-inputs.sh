#!/usr/bin/env bash
# Git index hashes represent path, mode and content, without a checkout timestamp.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
common=(package.json package-lock.json ':(glob)**/package.json' .dockerignore tsconfig.base.json)
case "${1:-}" in
  chess)
    inputs=(Dockerfile games/chess apps/server packages/engine-sdk packages/session-kit
      vite.config.ts vite.server.config.ts tsconfig.json)
    compatibility=(apps/server/src/store.ts apps/server/src/overdrive/store.ts
      ':(glob)games/chess/**/src/core/**' ':(glob)games/chess/**/src/online/protocol.ts')
    ;;
  platform)
    inputs=(Dockerfile.platform apps/platform apps/portal games/district/src games/district/maps packages/session-kit packages/telegram-transport
      vite.platform.config.ts tsconfig.platform.json)
    compatibility=(apps/platform/src/database.ts apps/platform/src/telegram/schema.ts packages/session-kit/src
      games/district/src/types.ts games/district/src/core.ts games/district/src/runtime.ts)
    ;;
  *) exit 2 ;;
esac
digest() {
  git ls-files --stage -z -- "$@" | shasum -a 256 | cut -d ' ' -f 1
}
printf '%s %s\n' "$(digest "${common[@]}" "${inputs[@]}")" "$(digest "${compatibility[@]}")"
