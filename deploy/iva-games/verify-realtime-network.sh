#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${IMAGE_TAG:?Set the already built candidate realtime image}"
: "${GITHUB_RUN_ID:?Only the isolated CI job supplies this test namespace}"
: "${GITHUB_RUN_ATTEMPT:?Missing CI attempt}"
test "${GITHUB_ACTIONS:-}" = true
name="iva-network-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
tools_image="${name}-tools:local"
directory="$(mktemp -d "${RUNNER_TEMP:-/tmp}/iva-network.XXXXXX")"
artifact_directory="${RUNNER_TEMP:-/tmp}/iva-realtime-network-artifacts"
mkdir -p "$artifact_directory"
chmod 700 "$artifact_directory"
artifact_report="$artifact_directory/realtime-network.json"
artifact_group="$(id -g)"
printf '%s\n' '{"passed":false,"stage":"before-harness","error":"Network helper did not produce a report"}' > "$artifact_report"
chgrp "$artifact_group" "$artifact_report"
chmod 660 "$artifact_report"
cleanup() {
  docker rm -f "$name-tools" "$name-runtime" >/dev/null 2>&1 || true
  docker volume rm "$name-data" >/dev/null 2>&1 || true
  docker image rm "$tools_image" >/dev/null 2>&1 || true
  rm -rf -- "$directory"
}
trap cleanup EXIT
node --input-type=module - "$directory" <<'JS'
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
const directory=process.argv[2],keys=generateKeyPairSync('ed25519');
writeFileSync(`${directory}/private.pem`,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
writeFileSync(`${directory}/public.json`,JSON.stringify({'network-test':keys.publicKey.export({type:'spki',format:'pem'})}),{mode:0o644});
chmodSync(`${directory}/public.json`,0o644);
JS
docker build --file deploy/iva-games/Dockerfile.network-test --build-arg "CANDIDATE_IMAGE=$IMAGE_TAG" --tag "$tools_image" .
docker volume create "$name-data" >/dev/null
docker run --detach --name "$name-runtime" --network none --cap-drop ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m --mount "type=volume,src=$name-data,dst=/data" \
  --mount "type=bind,src=$directory/public.json,dst=/keys/public.json,readonly" \
  --env NODE_ENV=test --env REALTIME_HOST=127.0.0.1 --env REALTIME_ALLOWED_ORIGINS=http://127.0.0.1:4320 \
  --env REALTIME_ALLOWED_HOSTS=127.0.0.1:4320 --env REALTIME_TRUSTED_KEYS_FILE=/keys/public.json --env REALTIME_MAX_MATCHES=1 "$IMAGE_TAG" >/dev/null
# The helper shares ONLY the newly created network-none container's namespace.
# No Docker socket, host network, production data, signing key or release SSH is mounted.
# Bind only the precreated report, preserving it before /tmp tmpfs cleanup.
# USER root has no DAC_OVERRIDE: grant its supplementary group write access to
# this one inode, not access to the runner-owned 0700 directory or broader caps.
if ! docker run --interactive --name "$name-tools" --network "container:$name-runtime" --cap-drop ALL --cap-add NET_ADMIN \
  --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  --group-add "$artifact_group" --mount "type=bind,src=$artifact_report,dst=/evidence/realtime-network.json" \
  --env IVA_NETWORK_TEST_SANDBOX=isolated-loopback "$tools_image" --mode netem --output /evidence/realtime-network.json < "$directory/private.pem"; then
  docker logs --tail 40 "$name-runtime" >&2
  exit 1
fi
docker inspect --format 'Candidate image={{.Image}} container={{.Id}}' "$name-runtime"
