#!/usr/bin/env bash
# Bootstrap Pocket ID + full Miootz stack.
#
# Usage:
#   ./scripts/bootstrap.sh [--dev] [--setup-admin] [--add-to-admins USERNAME] [--demo]
#
# Flow:
#   1. Generate keys if .env is missing/empty
#   2. Start Pocket ID via Docker Compose
#   3. Run Pocket ID bootstrap (groups, OIDC client)
#   4. Start full stack (API + Frontend + Traefik)
#   5. Print next steps (create admin account, etc.)
#
# After first run:
#   - Visit /setup to create your admin account + passkey
#   - Re-run with --setup-admin to add that account to admins + members groups
#   - Re-run with --demo to seed demo players and sessions

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Parse args
DEV=false
SETUP_ADMIN=false
ADD_TO_ADMINS=""
DEMO=false
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      DEV=true
      COMPOSE_FILE="docker-compose.dev.yml"
      ENV_FILE=".env.dev"
      shift
      ;;
    --setup-admin)
      SETUP_ADMIN=true
      shift
      ;;
    --add-to-admins)
      ADD_TO_ADMINS="$2"
      shift 2
      ;;
    --demo)
      DEMO=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ── 1. Generate keys if needed ──────────────────────────────────────────────

ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE.example" "$ENV_FILE" 2>/dev/null || cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from ${ENV_FILE}.example"
fi

# Helper: generate a random value and update .env
_update_env_if_empty() {
  local key="$1"
  local generator="$2"
  local current
  current=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [[ -z "$current" ]] || [[ "$current" == change-me* ]] || [[ "$current" == \<* ]]; then
    local val
    val=$(eval "$generator")
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    echo "Generated $key"
  fi
}

_update_env_if_empty "SECRET_KEY" \
  "python3 -c \"import secrets; print(secrets.token_urlsafe(32))\""
_update_env_if_empty "ENCRYPTION_KEY" \
  "python3 -c \"import secrets; print(secrets.token_hex(32))\""
_update_env_if_empty "POCKET_ID_STATIC_API_KEY" \
  "python3 -c \"import secrets; print(secrets.token_urlsafe(32))\""

# Source .env so the Python script sees the vars
set -a
source "$ENV_FILE"
set +a

# ── 2. Start Pocket ID ─────────────────────────────────────────────────────

echo ""
echo "Starting Pocket ID ..."
docker-compose -f "$COMPOSE_FILE" up -d pocket-id

# ── 3. Run Pocket ID bootstrap ─────────────────────────────────────────────

# Run the bootstrap script inside the api container so it can reach
# Pocket ID via the Docker-internal hostname (pocket-id:1411).
# Mount .env so the script can update it with discovered values.
echo "Running Pocket ID bootstrap ..."
DOCKER_ARGS=()
if $DEV; then
  DOCKER_ARGS+=("--dev")
fi
if $SETUP_ADMIN; then
  DOCKER_ARGS+=("--setup-admin")
fi
if [[ -n "$ADD_TO_ADMINS" ]]; then
  DOCKER_ARGS+=("--add-to-admins" "$ADD_TO_ADMINS")
fi

docker-compose -f "$COMPOSE_FILE" run --rm \
  -v "$PROJECT_DIR/$ENV_FILE:/app/.env:rw" \
  -v "$PROJECT_DIR/scripts:/app/scripts:ro" \
  -v "$PROJECT_DIR/data:/data" \
  api \
  uv run python scripts/bootstrap_pocket_id.py "${DOCKER_ARGS[@]}"

# ── 4. Start full stack ────────────────────────────────────────────────────

echo ""
echo "Starting full stack ..."
docker-compose -f "$COMPOSE_FILE" up -d

# ── 5. Demo data ───────────────────────────────────────────────────────────

if $DEMO; then
  echo ""
  echo "Seeding demo data ..."
  docker-compose -f "$COMPOSE_FILE" run --rm \
    -v "$PROJECT_DIR/$ENV_FILE:/app/.env:ro" \
    -v "$PROJECT_DIR/data:/data" \
    api \
    uv run python -m app.bootstrap_data --demo --force
fi

# ── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "Services:"
if $DEV; then
  echo "  App     : https://app.miootz.local:8443"
  echo "  API     : https://api.miootz.local:8443"
  echo "  Pocket  : https://auth.miootz.local:8443"
else
  echo "  App     : https://app.miootz.local"
  echo "  API     : https://api.miootz.local"
  echo "  Pocket  : https://auth.miootz.local"
fi
echo ""
echo "Next steps:"
if [[ -z "$ADD_TO_ADMINS" ]] && ! $SETUP_ADMIN; then
  echo "  2. Visit /setup to create your admin account + passkey"
  echo "  3. Re-run with --setup-admin to add that account to the admins group"
fi
if ! $DEMO; then
  echo "  5. Re-run with --demo to seed demo players and sessions"
fi
echo "═══════════════════════════════════════"
