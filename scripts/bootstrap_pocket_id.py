"""
Idempotent Pocket ID bootstrap script.

Creates groups, OIDC clients, and admin setup via the Pocket ID
admin API.  Safe to run multiple times — skips resources that already exist.

Admin setup flow:
  1. Visit /setup to create your admin account with a passkey.
  2. Re-run with --setup-admin to add that account to admins + members groups.
     (Alternatively: --add-to-admins USERNAME to target a specific user.)

Requires:
  POCKET_ID_INTERNAL_URL    – internal URL (e.g. http://pocket-id:1411)
  POCKET_ID_APP_URL         – public URL (e.g. https://auth.miootz.local)
  POCKET_ID_STATIC_API_KEY  – STATIC_API_KEY from Pocket ID env

Usage:
  uv run python scripts/bootstrap_pocket_id.py [--dev] [--setup-admin] [--add-to-admins USERNAME]
"""

import argparse
import os
import sys
import time
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

POCKET_ID_URL = os.environ.get(
    "POCKET_ID_INTERNAL_URL", "http://pocket-id:1411"
).rstrip("/")
STATIC_API_KEY = os.environ.get("POCKET_ID_STATIC_API_KEY", "")

DEV_REDIRECT = "http://localhost:5173/auth/callback"


def public_url(domain_variable: str, is_dev: bool) -> str:
    domain = os.environ.get(domain_variable)
    if not domain:
        if not is_dev:
            raise RuntimeError(f"{domain_variable} must be set for production bootstrap")
        domain = {"APP_DOMAIN": "app.miootz.local", "AUTH_DOMAIN": "auth.miootz.local"}[
            domain_variable
        ]
    return f"https://{domain}{':8443' if is_dev else ''}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _headers():
    return {"X-API-KEY": STATIC_API_KEY, "Content-Type": "application/json"}


def wait_for_pocket_id(url: str, timeout: int = 60) -> None:
    """Poll Pocket ID until the health endpoint responds."""
    deadline = time.monotonic() + timeout
    print(f"Waiting for Pocket ID at {url} ...")
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{url}/health", timeout=3, follow_redirects=False)
            if r.status_code < 500:
                print("Pocket ID is ready.")
                return
        except httpx.RequestError:
            pass
        time.sleep(1)
    raise RuntimeError(f"Pocket ID did not become ready within {timeout}s")


def _get_json(
    client: httpx.Client, path: str, params: dict | None = None
) -> dict | list:
    r = client.get(f"{POCKET_ID_URL}{path}", headers=_headers(), params=params or {})
    r.raise_for_status()
    return r.json()


def _post_json(client: httpx.Client, path: str, body: dict) -> dict:
    r = client.post(f"{POCKET_ID_URL}{path}", headers=_headers(), json=body)
    r.raise_for_status()
    return r.json()


def _put_json(client: httpx.Client, path: str, body: dict) -> dict:
    r = client.put(f"{POCKET_ID_URL}{path}", headers=_headers(), json=body)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Idempotent resource creation
# ---------------------------------------------------------------------------


def ensure_groups(client: httpx.Client) -> dict[str, str]:
    """Create 'members' and 'admins' groups if they don't exist. Returns {name: id}."""
    groups_map: dict[str, str] = {}
    try:
        data = _get_json(client, "/api/user-groups")
        existing = (
            data if isinstance(data, list) else data.get("data", data.get("items", []))
        )
        for g in existing:
            groups_map[g["name"]] = g["id"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            pass  # No groups yet
        else:
            raise

    needed = ["members", "admins"]
    for name in needed:
        if name not in groups_map:
            print(f"  Creating group '{name}' ...")
            result = _post_json(
                client,
                "/api/user-groups",
                {
                    "friendlyName": name,
                    "name": name,
                },
            )
            groups_map[name] = result["id"]
            print(f"    → {result['id']}")
        else:
            print(f"  Group '{name}' already exists → {groups_map[name]}")

    return groups_map


def ensure_oidc_client(client: httpx.Client, is_dev: bool) -> str:
    """Create 'miootz-app' OIDC client if it doesn't exist. Always ensures
    callback URLs are up to date. Returns client ID."""
    target_id = "miootz-app"
    redirect_uris = [f"{public_url('APP_DOMAIN', is_dev)}/auth/callback"]
    if is_dev:
        redirect_uris.insert(0, DEV_REDIRECT)

    existing_client = None
    try:
        data = _get_json(client, "/api/oidc/clients")
        clients = (
            data if isinstance(data, list) else data.get("data", data.get("items", []))
        )
        for c in clients:
            if c.get("id") == target_id:
                existing_client = c
                break
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            pass
        else:
            raise

    if existing_client is not None:
        # Ensure callback URLs are up to date
        current_uris = set(existing_client.get("callbackURLs", []))
        needed_uris = set(redirect_uris)
        if current_uris != needed_uris:
            print(f"  Updating OIDC client '{target_id}' callback URLs ...")
            existing_client["callbackURLs"] = redirect_uris
            _put_json(client, f"/api/oidc/clients/{target_id}", existing_client)
        else:
            print(f"  OIDC client '{target_id}' is up to date.")
    else:
        print(f"  Creating OIDC client '{target_id}' ...")
        result = _post_json(
            client,
            "/api/oidc/clients",
            {
                "id": target_id,
                "name": "Miootz",
                "callbackURLs": redirect_uris,
                "isPublic": True,
                "pkceEnabled": True,
            },
        )
        print(f"    → client_id = {result.get('id', target_id)}")
    return target_id


def remind_api_key() -> None:
    """Note that POCKET_ID_STATIC_API_KEY is used for admin API calls."""
    print("  POCKET_ID_STATIC_API_KEY handles all admin API calls.")


def _find_user(
    client: httpx.Client, username: str
) -> dict | None:
    """Search for a user by username. Returns the user dict or None."""
    try:
        data = _get_json(client, f"/api/users?search={username}")
        existing = (
            data if isinstance(data, list) else data.get("data", data.get("items", []))
        )
        for u in existing:
            if u.get("username") == username:
                return u
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            raise
    return None


def _list_all_users(client: httpx.Client) -> list[dict]:
    """List all users in Pocket ID."""
    try:
        data = _get_json(client, "/api/users")
        return (
            data if isinstance(data, list)
            else data.get("data", data.get("items", []))
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return []
        raise


def _add_user_to_groups(
    client: httpx.Client,
    user: dict,
    group_ids: list[str],
) -> None:
    """Add a user to the given groups (idempotent — skips already-assigned groups)."""
    user_id = user["id"]
    username = user.get("username", user_id)
    current_groups = [g["id"] for g in user.get("userGroups", [])]
    missing = [gid for gid in group_ids if gid not in current_groups]
    if not missing:
        print(f"  User '{username}' is already in all target groups.")
        return
    current_groups.extend(missing)
    group_names = ", ".join(missing)
    print(f"  Adding user '{username}' to group(s): {group_names} ...")
    _put_json(
        client,
        f"/api/users/{user_id}/user-groups",
        {"userGroupIds": current_groups},
    )
    print("    → done")


def add_user_to_admins(
    client: httpx.Client, username: str, admin_group_id: str, members_group_id: str
) -> bool:
    """Find user by username and add them to the admins (and members) group.
    Returns True if done."""
    if not username:
        return False

    user = _find_user(client, username)
    if not user:
        print(f"  User '{username}' not found in Pocket ID.")
        print("  Create your account first via /login/setup, then re-run this script.")
        return False

    _add_user_to_groups(client, user, [admin_group_id, members_group_id])
    return True


def setup_admin(
    client: httpx.Client, admin_group_id: str, members_group_id: str, pocket_id_url: str
) -> bool:
    """
    Find the user created via Pocket ID /setup (the initial admin) and
    add them to the 'admins' and 'members' groups.

    Searches for the 'admin' user (the default username Pocket ID assigns
    to the initial setup account). Returns True if a user was found and updated.
    """
    username = "admin"
    user = _find_user(client, username)
    if not user:
        print(f"  User '{username}' not found in Pocket ID.")
        print("  Create your account first by visiting /setup")
        print(f"    → {pocket_id_url}/login/setup")
        return False

    _add_user_to_groups(client, user, [admin_group_id, members_group_id])
    print(f"  User '{username}' is now in admins + members groups.")
    return True


def _ensure_db_initialized() -> None:
    """Ensure the SQLite database schema is created."""
    import asyncio
    from app.core.database import engine, Base, init_db
    from app.core.migrations import run_sqlite_migrations

    async def _init():
        await init_db()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await run_sqlite_migrations(conn)

    asyncio.run(_init())


# ---------------------------------------------------------------------------
# Env file update
# ---------------------------------------------------------------------------


def update_env_file(
    members_group_id: str,
    is_dev: bool,
) -> None:
    """Update .env with discovered values."""
    env_path = Path(".env")
    if not env_path.exists():
        example = Path(".env.example")
        if example.exists():
            env_path.write_text(example.read_text())
            print("Created .env from .env.example")
        else:
            print("No .env or .env.example found — skipping env update.")
            return

    content = env_path.read_text()
    lines = content.splitlines()
    updated = False

    replacements: dict[str, str] = {}
    replacements["POCKET_ID_MEMBERS_GROUP_ID"] = members_group_id

    auth_url = public_url("AUTH_DOMAIN", is_dev)
    replacements["POCKET_ID_OIDC_ISSUER"] = auth_url
    replacements["POCKET_ID_APP_URL"] = auth_url

    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        replaced = False
        for key, val in replacements.items():
            if stripped.startswith(f"{key}="):
                current_val = stripped.split("=", 1)[1].strip().strip('"').strip("'")
                if (
                    not current_val
                    or current_val.startswith("change-me")
                    or current_val.startswith("<")
                ):
                    new_lines.append(f"{key}={val}")
                    replaced = True
                    updated = True
                    break
        if not replaced:
            new_lines.append(line)

    if updated:
        env_path.write_text("\n".join(new_lines) + "\n")
        print(f"Updated {env_path}")
    else:
        print("No .env updates needed (values already set).")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap Pocket ID configuration")
    parser.add_argument(
        "--dev", action="store_true", help="Dev mode (localhost redirects, :8443)"
    )
    parser.add_argument(
        "--setup-admin",
        action="store_true",
        help="Find the /setup user and add them to admins + members groups",
    )
    parser.add_argument(
        "--add-to-admins",
        default="",
        help="Username to add to the admins + members groups (account must already exist)",
    )
    args = parser.parse_args()

    pocket_id_url = os.environ.get("POCKET_ID_APP_URL") or public_url("AUTH_DOMAIN", args.dev)

    if not STATIC_API_KEY:
        print("Error: POCKET_ID_STATIC_API_KEY is not set.", file=sys.stderr)
        print(
            "Set it in your .env or export it before running this script.",
            file=sys.stderr,
        )
        sys.exit(1)

    wait_for_pocket_id(POCKET_ID_URL)

    with httpx.Client(timeout=15) as client:
        print("\n── Groups ──")
        groups = ensure_groups(client)

        print("\n── OIDC Client ──")
        ensure_oidc_client(client, args.dev)

        print("\n── API Key ──")
        remind_api_key()

        if args.setup_admin:
            print("\n── Setup Admin ──")
            setup_admin(
                client,
                groups.get("admins", ""),
                groups.get("members", ""),
                pocket_id_url,
            )

        if args.add_to_admins:
            print(f"\n── Add '{args.add_to_admins}' to admins ──")
            add_user_to_admins(
                client,
                args.add_to_admins,
                groups.get("admins", ""),
                groups.get("members", ""),
            )


    print("\n── .env Update ──")
    update_env_file(groups["members"], args.dev)

    # Summary
    setup_url = pocket_id_url.replace("http://", "https://")
    print("\n═══════════════════════════════════════")
    print("Bootstrap complete!")
    print(f"  members group : {groups['members']}")
    print(f"  admins group  : {groups['admins']}")
    print()
    print("  Next steps:")
    print(f"    1. Visit {setup_url}/login/setup to create your admin account + passkey")
    print("    2. Re-run with --setup-admin to add that account to the admins group")
    print("═══════════════════════════════════════")


if __name__ == "__main__":
    main()
