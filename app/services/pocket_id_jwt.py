"""Pocket ID JWT validation — fetch JWKS, validate RS256 tokens, extract claims."""

import logging
import time
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

def assert_oidc_config() -> None:
    """Fail fast at startup if JWT validation would silently degrade.

    With Pocket ID configured, an empty issuer/client-id makes iss/aud
    validation skip (accepting tokens minted for other clients), so the
    deployment should refuse to boot instead of running with a hole.
    """
    if not settings.POCKET_ID_INTERNAL_URL:
        return  # no Pocket ID at all (e.g. the isolated demo)
    missing = [
        name
        for name in ("POCKET_ID_OIDC_ISSUER", "POCKET_ID_OIDC_CLIENT_ID")
        if not getattr(settings, name)
    ]
    if missing:
        raise RuntimeError(
            f"{', '.join(missing)} must be set when POCKET_ID_INTERNAL_URL "
            "is configured — iss/aud validation is skipped without them"
        )


# Cache JWKS keys with TTL
_jwks_cache: dict[str, Any] | None = None
_jwks_cache_ttl: float = 0
_JWKS_TTL_SECONDS = 3600  # 1 hour
_JWKS_REQUEST_TIMEOUT = 3  # seconds — keep short so /me responds quickly
#: Minimum seconds between forced (off-TTL) JWKS refreshes triggered by an
#: unknown `kid` — bounds abuse from garbage tokens with bogus kid values.
_JWKS_FORCED_MIN_INTERVAL = 60
_last_forced_fetch: float = 0.0
#: Clock skew tolerated for exp/nbf claims.
_CLOCK_LEEWAY_SECONDS = 30


async def _fetch_jwks(force: bool = False) -> dict[str, Any] | None:
    """Fetch JWKS from Pocket ID.

    Uses the internal URL (pocket-id:1411) so this works from inside Docker.
    ``force=True`` bypasses the TTL once per ``_JWKS_FORCED_MIN_INTERVAL``
    (used when a token's ``kid`` is missing from the cached keyset, e.g. right
    after Pocket ID rotates keys).
    """
    global _jwks_cache, _jwks_cache_ttl, _last_forced_fetch

    now = time.monotonic()
    if _jwks_cache is not None and now < _jwks_cache_ttl:
        if not force or (now - _last_forced_fetch) < _JWKS_FORCED_MIN_INTERVAL:
            return _jwks_cache
        _last_forced_fetch = now  # off-TTL refresh attempt

    base_url = settings.POCKET_ID_INTERNAL_URL.rstrip("/")
    oidc_url = f"{base_url}/.well-known/openid-configuration"

    try:
        async with httpx.AsyncClient(timeout=_JWKS_REQUEST_TIMEOUT) as client:
            r = await client.get(oidc_url)
            r.raise_for_status()
            oidc = r.json()
    except Exception as e:
        logger.warning("Failed to fetch OIDC config from %s: %s", oidc_url, e)
        return _jwks_cache  # return stale cache if available

    jwks_uri = oidc.get("jwks_uri")
    if not jwks_uri:
        logger.warning("No jwks_uri in OIDC config from %s", oidc_url)
        return None

    # The JWKS URI from the OIDC doc is the public URL; rewrite to internal.
    jwks_path = (
        jwks_uri.split("//", 1)[1].split("/", 1)[1] if "//" in jwks_uri else jwks_uri
    )
    jwks_uri = f"{base_url}/{jwks_path}"

    try:
        async with httpx.AsyncClient(timeout=_JWKS_REQUEST_TIMEOUT) as client:
            r = await client.get(jwks_uri)
            r.raise_for_status()
            jwks = r.json()
    except Exception as e:
        logger.warning("Failed to fetch JWKS from %s: %s", jwks_uri, e)
        return _jwks_cache

    _jwks_cache = jwks
    _jwks_cache_ttl = now + _JWKS_TTL_SECONDS
    return jwks


def _find_key(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    """Find a JWK by exact kid match.

    No fallback to the first key: accepting an arbitrary key lets any token
    whose kid simply isn't present sail through with the wrong public key
    (it will fail signature check, but silently mismatching also masks key
    rotation problems — reject explicitly instead).
    """
    if not kid:
        return None
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None


def _base64url_decode(s: str) -> bytes:
    """Decode base64url string to bytes."""
    import base64

    # Add padding
    rem = len(s) % 4
    if rem:
        s += "=" * (4 - rem)
    return base64.urlsafe_b64decode(s)


def _decode_jwt_payload(payload_b64: str) -> dict[str, Any] | None:
    """Decode the JWT payload (middle segment)."""
    try:
        import json

        decoded = _base64url_decode(payload_b64)
        return json.loads(decoded)
    except Exception as e:
        logger.warning("Failed to decode JWT payload: %s", e)
        return None


def _validate_rs256_signature(
    signing_input: bytes,
    signature_b64: str,
    jwk: dict[str, Any],
) -> bool:
    """Validate RS256 signature using a JWK."""
    try:
        from cryptography.hazmat.primitives.asymmetric import rsa, padding
        from cryptography.hazmat.primitives import hashes

        # Decode signature
        sig = _base64url_decode(signature_b64)

        # Build RSA public key from JWK
        n_b64 = jwk.get("n", "")
        e_b64 = jwk.get("e", "")

        n_bytes = _base64url_decode(n_b64)
        e_bytes = _base64url_decode(e_b64)

        n_int = int.from_bytes(n_bytes, "big")
        e_int = int.from_bytes(e_bytes, "big")

        pub_key = rsa.RSAPublicNumbers(e_int, n_int).public_key()

        # Verify signature
        try:
            pub_key.verify(sig, signing_input, padding.PKCS1v15(), hashes.SHA256())
            return True
        except Exception:
            return False
    except Exception as e:
        logger.warning("RS256 signature validation error: %s", e)
        return False


def _validate_claims(claims: dict[str, Any]) -> bool:
    """Validate iss/aud/exp/nbf against configured expectations.

    Without these checks any token signed by the same Pocket ID key for a
    *different* client would be accepted as a miootz meetup.
    Skipped (with a warning) when the corresponding setting is empty —
    preserves dev flexibility but production must set both.
    """
    now_ts = time.time()

    exp = claims.get("exp")
    try:
        if exp is None or now_ts > float(exp) + _CLOCK_LEEWAY_SECONDS:
            logger.warning("JWT missing/expired exp (exp=%s, now=%s)", exp, now_ts)
            return False
    except TypeError, ValueError:
        logger.warning("JWT exp not numeric (exp=%r)", exp)
        return False

    nbf = claims.get("nbf")
    if nbf is not None:
        try:
            if now_ts < float(nbf) - _CLOCK_LEEWAY_SECONDS:
                logger.warning("JWT not yet valid (nbf=%s, now=%s)", nbf, now_ts)
                return False
        except TypeError, ValueError:
            logger.warning("JWT nbf not numeric (nbf=%r)", nbf)
            return False

    expected_iss = settings.POCKET_ID_OIDC_ISSUER.rstrip("/")
    if expected_iss:
        actual_iss = str(claims.get("iss", "")).rstrip("/")
        if actual_iss != expected_iss:
            logger.warning(
                "JWT iss mismatch (got=%r, want=%r)", actual_iss, expected_iss
            )
            return False
    else:
        logger.warning("POCKET_ID_OIDC_ISSUER not set — skipping iss validation")

    expected_aud = settings.POCKET_ID_OIDC_CLIENT_ID
    if expected_aud:
        aud = claims.get("aud")
        aud_list = [aud] if isinstance(aud, str) else list(aud or [])
        if expected_aud not in aud_list:
            logger.warning("JWT aud mismatch (got=%r, want=%r)", aud, expected_aud)
            return False
    else:
        logger.warning("POCKET_ID_OIDC_CLIENT_ID not set — skipping aud validation")

    return True


async def validate_pocket_id_token(access_token: str) -> dict[str, Any] | None:
    """
    Validate a Pocket ID access_token JWT.

    Returns the decoded claims dict if valid, None otherwise.
    """

    parts = access_token.split(".")
    if len(parts) != 3:
        logger.warning("JWT does not have 3 segments")
        return None

    header_b64, payload_b64, signature_b64 = parts

    # Decode header to get kid
    try:
        import json

        header_decoded = _base64url_decode(header_b64)
        header = json.loads(header_decoded)
    except Exception as e:
        logger.warning("Failed to decode JWT header: %s", e)
        return None

    kid = header.get("kid")

    # Reject tokens that don't declare RS256 before touching the network —
    # explicit defense-in-depth against alg confusion (we only ever verify
    # RS256 signatures below, but failing fast keeps the path obvious).
    if header.get("alg") != "RS256":
        logger.warning("JWT alg not RS256 (alg=%r)", header.get("alg"))
        return None

    # Fetch JWKS
    jwks = await _fetch_jwks()
    key = _find_key(jwks, kid) if jwks else None
    if key is None:
        # kid unknown (and we hold a valid RSA key set) — could be a key
        # rotation: force one off-TTL refresh before rejecting.
        if jwks and jwks.get("keys"):
            refreshed = await _fetch_jwks(force=True)
            if refreshed:
                key = _find_key(refreshed, kid)
    if not key:
        logger.warning("No matching JWK found (kid=%s)", kid)
        return None

    # Validate signature
    signing_input = f"{header_b64}.{payload_b64}".encode()
    if not _validate_rs256_signature(signing_input, signature_b64, key):
        logger.warning("JWT signature validation failed")
        return None

    # Decode and validate payload (exp/nbf/iss/aud)
    claims = _decode_jwt_payload(payload_b64)
    if not claims:
        return None

    if not _validate_claims(claims):
        return None

    return claims
