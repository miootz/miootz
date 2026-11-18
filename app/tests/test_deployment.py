import os
from pathlib import Path
import subprocess

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
