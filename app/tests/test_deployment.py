import os
from pathlib import Path
import subprocess
import sys

import pytest

from scripts import bootstrap_pocket_id


@pytest.mark.parametrize(
    ("is_dev", "expected"),
    [
        (False, ["https://app.example.test/auth/callback"]),
        (True, ["http://localhost:5173/auth/callback", "https://app.example.test:8443/auth/callback"]),
    ],
)
def test_bootstrap_uses_configured_callback(monkeypatch, is_dev, expected):
    monkeypatch.setenv("APP_DOMAIN", "app.example.test")
    monkeypatch.setattr(bootstrap_pocket_id, "_get_json", lambda *args: [])
    created = {}
    monkeypatch.setattr(
        bootstrap_pocket_id, "_post_json", lambda client, path, body: created.update(body) or body
    )

    bootstrap_pocket_id.ensure_oidc_client(None, is_dev)

    assert created["callbackURLs"] == expected


def test_bootstrap_fills_auth_urls_from_domain(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("AUTH_DOMAIN", "login.example.test")
    env_path = tmp_path / ".env"
    env_path.write_text("POCKET_ID_MEMBERS_GROUP_ID=\nPOCKET_ID_OIDC_ISSUER=\nPOCKET_ID_APP_URL=\n")

    bootstrap_pocket_id.update_env_file("members-id", False)

    assert env_path.read_text().splitlines() == [
        "POCKET_ID_MEMBERS_GROUP_ID=members-id",
        "POCKET_ID_OIDC_ISSUER=https://login.example.test",
        "POCKET_ID_APP_URL=https://login.example.test",
    ]


def test_production_bootstrap_requires_a_domain(monkeypatch):
    monkeypatch.delenv("APP_DOMAIN", raising=False)
    with pytest.raises(RuntimeError, match="APP_DOMAIN"):
        bootstrap_pocket_id.public_url("APP_DOMAIN", False)


def test_deploy_env_provisions_once_without_printing_contents(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/deploy-remote.sh").read_text()
    script = script.replace(r"\$HOME/miootz/", r"\$TEST_DEPLOY_ROOT/miootz/")
    assert r"\$TEST_DEPLOY_ROOT/miootz/" in script
    script_path = tmp_path / "deploy-remote.sh"
    script_path.write_text(script)
    (tmp_path / "deploy-host.sh").write_text("")
    secret = "APP_DOMAIN=app.example.test\nTOKEN=literal-$(should-not-run)"
    env = dict(
        os.environ,
        TEST_DEPLOY_ROOT=str(tmp_path),
        SSH_HOST="host.example.test",
        SSH_USER="deployer",
        SSH_PRIVATE_KEY="example-key",
        SSH_KNOWN_HOSTS="example-host-key",
        GITHUB_RUN_ID="42",
        DEPLOY_ENV=secret,
    )
    wrapper = (
        'ssh() { local command="${@: -1}"; '
        'case "$command" in "bash -s -- "*) cat >/dev/null ;; *) bash -c "$command" ;; esac; }; '
        'source "$1" demo "$2"'
    )

    for attempt in ("1", "2"):
        env["GITHUB_RUN_ATTEMPT"] = attempt
        if attempt == "2":
            env["DEPLOY_ENV"] = "replacement-must-not-be-used"
        result = subprocess.run(
            ["bash", "-c", wrapper, str(script_path), str(script_path), str(root)],
            env=env, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
        assert secret not in result.stdout + result.stderr
        env_file = tmp_path / "miootz/demo/.env"
        assert env_file.read_text() == secret + "\n"
        assert env_file.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    ("target", "secret_present", "existing", "data_exists", "truncate"),
    [
        ("production", True, None, True, False),
        ("production", True, "file", True, False),
        ("production", True, "symlink", True, False),
        ("production", True, "directory", True, False),
        ("production", False, None, True, False),
        ("demo", True, None, True, False),
        ("production", True, None, False, False),
        ("production", True, None, True, True),
    ],
)
def test_deploy_vapid_key_is_private_and_never_replaced(
    tmp_path, target, secret_present, existing, data_exists, truncate
):
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/deploy-remote.sh").read_text()
    script = script.replace(r"\$HOME/miootz/", r"\$TEST_DEPLOY_ROOT/miootz/")
    script_path = tmp_path / "deploy-remote.sh"
    script_path.write_text(script)
    (tmp_path / "deploy-host.sh").write_text("")
    data = tmp_path / "miootz" / target / "data"
    if data_exists:
        data.mkdir(parents=True)
    key = data / "vapid-private.pem"
    if existing == "file":
        key.write_text("existing key\n")
        key.chmod(0o640)
    elif existing == "symlink":
        key.symlink_to("missing-key.pem")
    elif existing == "directory":
        key.mkdir()
    secret = "-----BEGIN PRIVATE KEY-----\nliteral-$(should-not-run)\n-----END PRIVATE KEY-----"
    env = dict(
        os.environ,
        TEST_DEPLOY_ROOT=str(tmp_path),
        SSH_HOST="host.example.test",
        SSH_USER="deployer",
        SSH_PRIVATE_KEY="example-key",
        SSH_KNOWN_HOSTS="example-host-key",
        GITHUB_RUN_ID="42",
        TEST_TRUNCATE="1" if truncate else "0",
    )
    env.pop("DEPLOY_ENV", None)
    env.pop("VAPID_PRIVATE_KEY_PEM", None)
    if secret_present:
        env["VAPID_PRIVATE_KEY_PEM"] = secret
    wrapper = (
        'ssh() { local command="${@: -1}"; '
        'case "$command" in "bash -s -- "*) cat >/dev/null ;; '
        '*vapid-private.pem*) if [[ "$TEST_TRUNCATE" == 1 ]]; then head -c 10 | bash -c "$command"; '
        'else bash -c "$command"; fi ;; *) bash -c "$command" ;; esac; }; '
        'source "$1" "$2" "$3"'
    )
    if sys.platform == "darwin":
        # GNU ln -T is used on the Linux host; os.link has the same no-clobber semantics.
        wrapper = (
            'ln() { if [[ "$1" == -T ]]; then '
            'python3 -c "import os, sys; os.link(sys.argv[1], sys.argv[2])" "$2" "$3"; '
            'else command ln "$@"; fi; }; export -f ln; ' + wrapper
        )

    for attempt in ("1", "2"):
        env["GITHUB_RUN_ATTEMPT"] = attempt
        if secret_present and attempt == "2":
            env["VAPID_PRIVATE_KEY_PEM"] = "replacement-must-not-be-used"
        result = subprocess.run(
            ["bash", "-c", wrapper, str(script_path), str(script_path), target, str(root)],
            env=env, capture_output=True, text=True,
        )
        assert (result.returncode == 0) is (data_exists and existing != "directory" and not truncate), result.stderr
        assert secret not in result.stdout + result.stderr
        assert "replacement-must-not-be-used" not in result.stdout + result.stderr
        if not data_exists:
            assert "Production data directory is missing" in result.stderr
            assert not data.exists()
        elif existing == "symlink":
            assert key.is_symlink() and key.readlink() == Path("missing-key.pem")
        elif existing == "file":
            assert key.read_text() == "existing key\n"
            assert key.stat().st_mode & 0o777 == 0o640
        elif existing == "directory":
            assert key.is_dir() and not list(key.iterdir())
        elif truncate:
            assert "Incomplete VAPID key transfer" in result.stderr
            assert not key.exists()
        elif target == "production" and secret_present:
            assert key.read_text() == secret + "\n"
            assert key.stat().st_mode & 0o777 == 0o600
        else:
            assert not key.exists()
        if data_exists:
            assert not list(data.glob(".vapid-private.pem.*"))


@pytest.mark.parametrize("target", ["demo", "production"])
@pytest.mark.parametrize("healthy", [True, False])
def test_host_deploy_promotes_only_healthy_release(tmp_path, target, healthy):
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/deploy-host.sh").read_text()
    script = script.replace('base="$HOME/miootz/$target"', 'base="$TEST_DEPLOY_ROOT/miootz/$target"')
    assert 'base="$TEST_DEPLOY_ROOT/miootz/$target"' in script
    script_path = tmp_path / "deploy-host.sh"
    script_path.write_text(script)
    base = tmp_path / "miootz" / target
    revision = f"{'a' * 40}-42-1"
    release = base / "releases" / revision
    release.mkdir(parents=True)
    (base / ".env").write_text("APP_DOMAIN=app.example.test\n")
    if target == "production":
        (base / "data").mkdir()
    (base / "current").symlink_to("previous")

    env = dict(os.environ, TEST_DEPLOY_ROOT=str(tmp_path), TEST_HEALTH="1" if healthy else "0")
    result = subprocess.run(
        [
            "bash", "-c",
            'docker() { case " $* " in *" exec "*) [[ "$TEST_HEALTH" == 1 ]] ;; esac; }; '
            'flock() { :; }; sleep() { :; }; source "$1" "$2" "$3"',
            "test", str(script_path), target, revision,
        ],
        env=env,
        capture_output=True,
        text=True,
    )

    assert (result.returncode == 0) is healthy
    assert (base / "current").readlink() == (release if healthy else Path("previous"))
    if target == "production":
        assert (release / "data").resolve() == base / "data"
        assert (release / ".env").resolve() == base / ".env"


@pytest.mark.parametrize(
    "failed_path",
    ["", "/api/demo", "/squad/api/demo", "/matchday/api/demo", "/squad/api/health", "/matchday/api/health"],
)
def test_host_demo_checks_every_gateway_route(tmp_path, failed_path):
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/deploy-host.sh").read_text().replace(
        'base="$HOME/miootz/$target"', 'base="$TEST_DEPLOY_ROOT/miootz/$target"'
    )
    script_path = tmp_path / "deploy-host.sh"
    script_path.write_text(script)
    base = tmp_path / "miootz/demo"
    revision = f"{'a' * 40}-42-1"
    release = base / "releases" / revision
    release.mkdir(parents=True)
    (base / ".env").write_text("APP_DOMAIN=app.example.test\n")
    (base / "current").symlink_to("previous")
    requests = tmp_path / "requests"
    up_call = tmp_path / "up"
    env = dict(
        os.environ,
        TEST_DEPLOY_ROOT=str(tmp_path),
        TEST_FAIL_PATH=failed_path,
        TEST_REQUESTS=str(requests),
        TEST_UP_CALL=str(up_call),
    )
    wrapper = '''
        wget() {
          printf '%s\\n' "${@: -1}" >> "$TEST_REQUESTS"
          [[ "${@: -1}" != "http://127.0.0.1$TEST_FAIL_PATH" ]]
        }
        export -f wget
        docker() {
          case " $* " in
            *" up "*) printf '%s\\n' "$*" > "$TEST_UP_CALL" ;;
            *" exec -T frontend sh -c "*) bash -c "${@: -1}" ;;
          esac
        }
        flock() { :; }
        sleep() { return 1; }
        source "$1" demo "$2"
    '''
    result = subprocess.run(
        ["bash", "-c", wrapper, "test", str(script_path), revision],
        env=env,
        capture_output=True,
        text=True,
    )

    assert (result.returncode == 0) is (not failed_path)
    assert (base / "current").readlink() == (release if not failed_path else Path("previous"))
    assert "--remove-orphans" in up_call.read_text()
    if not failed_path:
        assert requests.read_text().splitlines() == [
            f"http://127.0.0.1{path}"
            for path in ("/api/demo", "/squad/api/demo", "/matchday/api/demo", "/squad/api/health", "/matchday/api/health")
        ]


def test_host_deploy_refuses_an_existing_lock(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts/deploy-host.sh").read_text().replace(
        'base="$HOME/miootz/$target"', 'base="$TEST_DEPLOY_ROOT/miootz/$target"'
    )
    script_path = tmp_path / "deploy-host.sh"
    script_path.write_text(script)
    base = tmp_path / "miootz/demo"
    revision = f"{'a' * 40}-42-1"
    (base / "releases" / revision).mkdir(parents=True)
    (base / ".env").write_text("APP_DOMAIN=app.example.test\n")
    result = subprocess.run(
        ["bash", "-c", 'flock() { return 1; }; source "$1" demo "$2"', "test", str(script_path), revision],
        env=dict(os.environ, TEST_DEPLOY_ROOT=str(tmp_path)),
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "Another deployment" in result.stderr
    assert not (base / "current").exists()
