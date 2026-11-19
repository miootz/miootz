#!/usr/bin/env bash
# Receives its script over SSH; release source, config and data stay separate.
set -euo pipefail
target="${1:?Missing target}"
revision="${2:?Missing revision}"
[[ "$target" == demo || "$target" == production ]] || exit 1
[[ "$revision" =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || exit 1
base="$HOME/miootz/$target"
release="$base/releases/$revision"
[[ -d "$release" && -f "$base/.env" ]] || { echo 'Release or host .env is missing' >&2; exit 1; }
exec 9>"$base/.deploy.lock"
flock -n 9 || { echo 'Another deployment is using this target' >&2; exit 1; }

if [[ "$target" == production ]]; then
  [[ -d "$base/data" ]] || { echo 'Production data directory is missing' >&2; exit 1; }
  export MIOOTZ_DATA_DIR="$base/data"
  ln -s "$base/.env" "$release/.env"
  ln -s "$base/data" "$release/data"
  compose=(docker compose --project-name miootz --env-file "$base/.env" -f "$release/docker-compose.yml")
else
  compose=(docker compose --project-name miootz-demo --env-file "$base/.env" -f "$release/docker-compose.demo-hosted.yml")
fi

# The runner streams this script over SSH. Keep Compose from reading its stdin.
"${compose[@]}" config -q </dev/null
if [[ "$target" == demo ]]; then
  "${compose[@]}" up -d --build --remove-orphans </dev/null
else
  "${compose[@]}" up -d --build </dev/null
fi

healthy=false
for _ in {1..60}; do
  if [[ "$target" == production ]]; then
    if "${compose[@]}" exec -T api python -c 'import os, urllib.request; urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/health", headers={"Host": os.environ["APP_DOMAIN"]}), timeout=2); urllib.request.urlopen("http://pocket-id:1411/health", timeout=2)' </dev/null >/dev/null 2>&1 && \
       "${compose[@]}" exec -T frontend wget -q -O /dev/null http://127.0.0.1/ </dev/null; then
      healthy=true; break
    fi
  elif "${compose[@]}" exec -T frontend sh -c 'for path in /api/demo /squad/api/demo /matchday/api/demo /squad/api/health /matchday/api/health; do wget -q -T 2 -O /dev/null "http://127.0.0.1$path" || exit 1; done' </dev/null >/dev/null 2>&1; then
    healthy=true; break
  fi
  sleep 2
done
if ! "$healthy"; then
  echo 'Health check failed; inspect the running containers before retrying.' >&2
  exit 1
fi
ln -sfn "$release" "$base/current"
echo "Deployed $target revision $revision"
