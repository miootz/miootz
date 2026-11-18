"""Isolated demo runner: python -m app.demo [--scenario full].

This entrypoint alone installs demo adapters. The production app never imports it.
The /api/demo menu selects a scenario and account for the shared database.
Hosted demos reset hourly; local demos reset on sign-in.
Every run owns a fresh temporary database and binds both servers to loopback,
unless the DEMO_BIND_HOST / DEMO_TRUSTED_HOSTS / DEMO_PUBLIC_APP_URL env vars
override it (e.g. when served from a container behind a reverse proxy).
"""

import argparse
import asyncio
from asyncio import sleep
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, UTC
import html
import json
import logging
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile


logger = logging.getLogger(__name__)
RESET_INTERVAL_SECONDS = 60 * 60


def configure_environment(
    directory: Path,
    frontend_port: int,
    *,
    enable_push: bool = False,
    simulate_invites: bool = False,
) -> None:
    # Override .env's real database, Pocket ID credentials, and notification keys.
    os.environ.update(
        {
            "DATABASE_URL": f"sqlite+aiosqlite:///{directory / 'demo.db'}",
            "AUDIT_DATABASE_URL": f"sqlite+aiosqlite:///{directory / 'demo-audit.db'}",
            "SCHEDULER_ENABLED": "false",
            "TRUSTED_HOSTS": os.environ.get(
                "DEMO_TRUSTED_HOSTS", "127.0.0.1,localhost"
            ),
            "CORS_ORIGINS": "",
            "PUBLIC_APP_URL": os.environ.get(
                "DEMO_PUBLIC_APP_URL", f"http://127.0.0.1:{frontend_port}"
            ),
            "POCKET_ID_INTERNAL_URL": "",
            "POCKET_ID_APP_URL": "",
            "POCKET_ID_OIDC_ISSUER": "",
            "POCKET_ID_OIDC_CLIENT_ID": "",
            "POCKET_ID_STATIC_API_KEY": "",
            "POCKET_ID_API_KEY": "",
            "POCKET_ID_MEMBERS_GROUP_ID": "",
            "VAPID_PUBLIC_KEY": "",
            "VAPID_PRIVATE_KEY": "",
        }
    )

    if simulate_invites:
        os.environ["POCKET_ID_APP_URL"] = "https://auth.miootz.example"

    if enable_push:
        from base64 import urlsafe_b64encode
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        key = ec.generate_private_key(ec.SECP256R1())
        private_path = directory / "demo-vapid.pem"
        private_path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        private_path.chmod(0o600)
        public = key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        os.environ.update(
            VAPID_PRIVATE_KEY=str(private_path),
            VAPID_PUBLIC_KEY=urlsafe_b64encode(public).decode().rstrip("="),
            VAPID_SUBJECT="mailto:demo@example.com",
        )


async def prepare(
    scenario: str,
    anchor: datetime,
    *,
    enable_push: bool = False,
    simulate_invites: bool = False,
    hourly_reset: bool = False,
):
    from app.api.main import app
    from app.api import middleware, users
    from app.core.database import Base, async_session, engine
    from app.demo_data import ACTORS, NAMES, SCENARIOS, seed_demo
    from app.services import pocket_id_jwt, weather_service
    from fastapi import HTTPException
    from fastapi.responses import HTMLResponse, RedirectResponse

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session() as db:
        manifest = await seed_demo(db, anchor=anchor, scenario=scenario)

    tokens = {role: secrets.token_urlsafe(32) for role in ACTORS}
    claims = {tokens[role]: {"sub": f"demo-{uid}"} for role, uid in ACTORS.items()}

    async def validate(token):
        return claims.get(token)

    async def get_user(sub):
        if not sub.startswith("demo-") or not sub.removeprefix("demo-").isdigit():
            return None
        try:
            uid = int(sub.removeprefix("demo-"))
        except ValueError:
            return None
        if not 1 <= uid <= len(NAMES):
            return None
        groups = ["admins", "members"] if uid == 1 else ["members"]
        return {
            "id": sub,
            "displayName": NAMES[uid - 1],
            "username": NAMES[uid - 1].lower().replace(" ", "."),
            "userGroups": [{"name": group} for group in groups],
        }

    async def no_jwks():
        return {"keys": []}

    async def sample_weather(*args, **kwargs):
        return {"temp_c": 22, "weather_code": 1, "label": "Mainly clear"}

    async def unavailable(*args, **kwargs):
        raise HTTPException(
            status_code=503,
            detail="Account invitations and deletion require the real Pocket ID service; they are disabled in this isolated demo.",
        )

    # The menu and its buttons are plain browser navigations without an
    # Authorization header; the demo owns these routes, so mark them public.
    middleware._PUBLIC_EXACT_PATHS = middleware._PUBLIC_EXACT_PATHS | {"/demo"}
    middleware._PUBLIC_PATH_PREFIXES = (
        middleware._PUBLIC_PATH_PREFIXES + ("/demo/login/", "/demo/scenario/")
    )
    if enable_push:
        middleware._PUBLIC_EXACT_PATHS = middleware._PUBLIC_EXACT_PATHS | {
            "/demo/push"
        }

    middleware.validate_pocket_id_token = validate
    middleware.get_user_by_id = get_user
    users.get_user_by_id = get_user
    users.create_signup_token = unavailable
    users.delete_user = unavailable
    pocket_id_jwt._fetch_jwks = no_jwks
    weather_service.fetch_forecast = sample_weather
    weather_service.fetch_current = sample_weather

    next_scenario = scenario
    reseed_lock = asyncio.Lock()

    async def reseed() -> None:
        nonlocal manifest
        selected = next_scenario
        # A single transaction keeps the old fixtures visible until the new ones are ready.
        async with engine.begin() as conn:
            await conn.exec_driver_sql("BEGIN IMMEDIATE")
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(table.delete())
            async with async_session(bind=conn) as db:
                new_manifest = await seed_demo(
                    db,
                    anchor=datetime.now(UTC).replace(tzinfo=None, microsecond=0),
                    scenario=selected,
                )
        manifest = new_manifest

    if hourly_reset:

        async def reset_hourly() -> None:
            while True:
                await sleep(RESET_INTERVAL_SECONDS)
                try:
                    await reseed()
                except Exception:
                    logger.exception("Could not reset the hosted demo database")

        app_lifespan = app.router.lifespan_context

        @asynccontextmanager
        async def demo_lifespan(app):
            async with app_lifespan(app) as state:
                task = asyncio.create_task(reset_hourly())
                try:
                    yield state
                finally:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task

        app.router.lifespan_context = demo_lifespan

    if simulate_invites:

        async def simulated_signup_token(**kwargs):
            return {
                "token": f"demo-invite-{secrets.token_hex(4)}",
                "expiresAt": (datetime.now(UTC) + timedelta(days=7))
                .replace(tzinfo=None)
                .isoformat(),
            }

        users.create_signup_token = simulated_signup_token

    if enable_push:

        @app.post("/demo/push")
        async def send_demo_push():
            from app.models.meetup import Meetup
            from app.models.user import User
            from app.services.web_push import notify_new_meetup_invites

            async with async_session() as db:
                meetup = await db.get(Meetup, 1)
                recipient = await db.get(User, ACTORS["newcomer"])
                if meetup is None or recipient is None:
                    raise HTTPException(status_code=404, detail="Demo data missing")
                await notify_new_meetup_invites(db, meetup, [recipient])
            return RedirectResponse("/api/demo", status_code=303)

    @app.get("/demo", response_class=HTMLResponse)
    async def demo_menu():
        scenario_buttons = "".join(
            f'<form method="post" action="/api/demo/scenario/{name}"><button>{html.escape(name.title())}{" — selected" if name == next_scenario else ""}</button></form>'
            for name in SCENARIOS
        )
        reset_note = (
            f"The shared game data resets every hour. Current scenario: {manifest['scenario'].title()}. "
            "Scenario selections take effect at the next reset. Signing in preserves shared progress."
            if hourly_reset
            else "Signing in resets the shared game data to the selected scenario."
        )
        buttons = "".join(
            f'<form method="post" action="/api/demo/login/{role}"><button>{html.escape(role.title())} · {html.escape(NAMES[uid - 1])}</button></form>'
            for role, uid in ACTORS.items()
        )
        push_control = (
            '<form method="post" action="/api/demo/push"><button>Send test invite to the demo newcomer</button></form>'
            if enable_push
            else ""
        )
        push_note = (
            "Test Web Push is enabled for devices registered in this temporary demo."
            if enable_push
            else "Real push delivery is disabled."
        )
        invite_note = (
            "Invitation generation is simulated; links use the reserved .example domain and cannot create real accounts."
            if simulate_invites
            else "Account invitations are disabled."
        )
        return f"""<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Miootz demo scenarios</title>
        <style>body{{font:16px system-ui;max-width:600px;margin:48px auto;padding:24px;color:#262033;background:#faf8ff}}button{{padding:14px;width:100%;margin:6px 0;background:#7c3aed;color:white;border:0;border-radius:12px;font:inherit;text-align:left}}a{{color:#6d28d9}}</style></head>
        <body><h1>Miootz demo</h1><p>Try sample accounts named after famous footballers. All meetups and match results are fictional.</p>
        <p>{reset_note}</p>{scenario_buttons}<hr><p><strong>Sign in as:</strong></p>{buttons}{push_control}<p>The guest button opens the reservation. Other accounts open their home screen.</p>
        <p>{push_note} {invite_note} Real passkeys and automatic scheduling are disabled.</p></body></html>"""

    @app.post("/demo/scenario/{name}", response_class=HTMLResponse)
    async def demo_switch_scenario(name: str):
        nonlocal next_scenario
        if name not in SCENARIOS:
            raise HTTPException(status_code=404, detail="Unknown demo scenario")
        next_scenario = name
        return await demo_menu()

    @app.post("/demo/login/{role}", response_class=HTMLResponse)
    async def demo_login(role: str):
        if role not in ACTORS:
            raise HTTPException(status_code=404, detail="Unknown demo account")
        if not hourly_reset:
            async with reseed_lock:
                await reseed()
        try:
            expires_at_ms = int(
                (datetime.now(UTC) + timedelta(hours=12)).timestamp() * 1000
            )
        except TypeError, ValueError, OverflowError:  # pragma: no cover - defensive
            expires_at_ms = 0
        token_data = {
            "accessToken": tokens[role],
            "refreshToken": "",
            "idToken": "",
            "expiresAt": expires_at_ms,
        }
        destination = manifest["guest_claim_path"] if role == "guest" else "/"
        # This response is served through Vite's same-origin /api proxy.
        return f"""<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>Opening demo…
        <script>
        void (async () => {{
        localStorage.setItem('miootz_tokens', {json.dumps(json.dumps(token_data))});
        localStorage.removeItem('miootz_id_token');
        localStorage.setItem('miootz-theme', 'light');
        sessionStorage.removeItem('miootz_return_path');
        sessionStorage.removeItem('miootz_pending_action');
        sessionStorage.removeItem('miootz_prefer_member_home');
        if ('caches' in window) await caches.delete('miootz-api-swr-v1');
        location.replace({json.dumps(destination)});
        }})();
        </script></body></html>"""

    return app, manifest


def check_port(port: int) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))


def ensure_dev_certs(root: Path) -> tuple[str, str]:
    """mkcert pair reused across loopback runs."""
    cert_dir = root / "data" / "demo-certs"
    cert_dir.mkdir(parents=True, exist_ok=True)
    key = cert_dir / "demo-key.pem"
    cert = cert_dir / "demo-cert.pem"
    if not key.exists() or not cert.exists():
        subprocess.run(
            [
                "mkcert",
                "-key-file", str(key),
                "-cert-file", str(cert),
                "127.0.0.1", "localhost",
            ],
            check=True,
        )
    return str(key), str(cert)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=["open", "full", "broadcast", "random", "live", "kickoff"],
        default="full",
        help="Scenario loaded at startup; the demo menu can switch any of them.",
    )
    parser.add_argument("--api-port", type=int, default=8010)
    parser.add_argument("--frontend-port", type=int, default=5180)
    parser.add_argument(
        "--api-only",
        action="store_true",
        help="Serve only the API for a separately built demo frontend.",
    )
    parser.add_argument(
        "--hourly-reset",
        action="store_true",
        help="Keep shared progress across sign-ins and reset the demo hourly.",
    )
    parser.add_argument(
        "--enable-push",
        action="store_true",
        help="Build the app and enable real Web Push with disposable keys for recording.",
    )
    parser.add_argument(
        "--simulate-invites",
        action="store_true",
        help="Record the real admin UI with simulated Pocket ID responses and nonfunctional .example links.",
    )
    parser.add_argument(
        "--https",
        action="store_true",
        help="Serve the frontend over HTTPS (mkcert) so phones get a secure context.",
    )
    args = parser.parse_args()
    bind_host = os.environ.get("DEMO_BIND_HOST", "127.0.0.1")
    check_port(args.api_port)
    if not args.api_only:
        if args.api_port == args.frontend_port:
            parser.error("API and frontend ports must differ")
        check_port(args.frontend_port)
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="miootz-demo-") as directory:
        configure_environment(
            Path(directory),
            args.frontend_port,
            enable_push=args.enable_push,
            simulate_invites=args.simulate_invites,
        )
        app, manifest = asyncio.run(
            prepare(
                args.scenario,
                datetime.now(UTC).replace(tzinfo=None, microsecond=0),
                enable_push=args.enable_push,
                simulate_invites=args.simulate_invites,
                hourly_reset=args.hourly_reset,
            )
        )
        print(json.dumps(manifest, indent=2), flush=True)
        import uvicorn

        if args.api_only:
            uvicorn.run(app, host=bind_host, port=args.api_port)
            return

        scheme = "https" if args.https else "http"
        public_url = os.environ.get(
            "DEMO_PUBLIC_APP_URL", f"{scheme}://127.0.0.1:{args.frontend_port}"
        )
        print(f"Open {public_url}/api/demo", flush=True)
        frontend_env = dict(
            os.environ,
            VITE_DOCKER_DEV="0",
            VITE_DEMO="1",
            MIOOTZ_API_PROXY_TARGET=f"http://127.0.0.1:{args.api_port}",
            VITE_API_BASE="/api",
            VITE_ALLOWED_HOSTS=os.environ["TRUSTED_HOSTS"],
            VITE_HTTPS_BOUNCE="0",
        )
        if args.https:
            key, cert = ensure_dev_certs(root)
            frontend_env.update(VITE_SSL_KEYFILE=key, VITE_SSL_CERTFILE=cert)
        frontend_args = ["npm", "run", "dev", "--"]
        if args.enable_push:
            output = str(Path(directory) / "frontend")
            subprocess.run(
                ["npm", "run", "build", "--", "--outDir", output],
                cwd=root / "frontend",
                env=frontend_env,
                check=True,
            )
            # Installed web apps have separate storage from Safari. Start at the
            # account chooser so they can establish their own demo meetup.
            web_manifest = Path(output) / "manifest.json"
            web_manifest_data = json.loads(web_manifest.read_text())
            web_manifest_data["start_url"] = "/api/demo"
            web_manifest_data["scope"] = "/"
            web_manifest.write_text(json.dumps(web_manifest_data))
            frontend_args = ["npm", "run", "preview", "--", "--outDir", output]
        frontend = subprocess.Popen(
            [
                *frontend_args,
                "--host",
                bind_host,
                "--port",
                str(args.frontend_port),
            ],
            cwd=root / "frontend",
            env=frontend_env,
        )
        try:
            uvicorn.run(app, host=bind_host, port=args.api_port)
        finally:
            frontend.terminate()
            try:
                frontend.wait(timeout=5)
            except subprocess.TimeoutExpired:
                frontend.kill()
                frontend.wait()


if __name__ == "__main__":
    main()
