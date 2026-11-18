#!/usr/bin/env bash
# Run on the GitHub runner; transfer only tracked files from the selected commit.
set -euo pipefail

target="${1:?Expected demo or production}"
source_dir="${2:?Expected the release checkout}"
[[ "$target" == demo || "$target" == production ]] || exit 1
: "${SSH_HOST:?Missing SSH_HOST}" "${SSH_USER:?Missing SSH_USER}"
: "${SSH_PRIVATE_KEY:?Missing SSH_PRIVATE_KEY}" "${SSH_KNOWN_HOSTS:?Missing SSH_KNOWN_HOSTS}"
: "${GITHUB_RUN_ID:?Missing GITHUB_RUN_ID}" "${GITHUB_RUN_ATTEMPT:?Missing GITHUB_RUN_ATTEMPT}"
[[ "$SSH_HOST" =~ ^[A-Za-z0-9.:-]+$ && "$SSH_USER" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]] || {
  echo 'Invalid SSH host or user' >&2; exit 1;
}
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || exit 1
sha="$(git -C "$source_dir" rev-parse --verify 'HEAD^{commit}')"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 1
revision="$sha-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"

umask 077
ssh_dir="$(mktemp -d)"
trap 'rm -rf "$ssh_dir"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
ssh_options=(-i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts"
  -o ConnectTimeout=15)
server="$SSH_USER@$SSH_HOST"

if [[ -n "${DEPLOY_ENV:-}" ]]; then
  printf '%s\n' "$DEPLOY_ENV" | ssh "${ssh_options[@]}" "$server" \
    "set -eu; umask 077; dir=\"\$HOME/miootz/$target\"; mkdir -p \"\$dir\"; \
    if [ -f \"\$dir/.env\" ]; then cat >/dev/null; echo 'Keeping existing host .env'; \
    else tmp=\$(mktemp \"\$dir/.env.XXXXXX\"); trap 'rm -f \"\$tmp\"' EXIT; \
    cat > \"\$tmp\"; ln \"\$tmp\" \"\$dir/.env\"; echo 'Created host .env'; fi"
fi

git -C "$source_dir" archive --format=tar HEAD | ssh "${ssh_options[@]}" "$server" \
  "set -eu; dir=\"\$HOME/miootz/$target/releases/$revision\"; mkdir -p \"\$dir\"; tar -xf - -C \"\$dir\""
ssh "${ssh_options[@]}" "$server" "bash -s -- '$target' '$revision'" < "$(dirname "$0")/deploy-host.sh"
