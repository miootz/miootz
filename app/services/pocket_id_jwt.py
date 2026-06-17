"""Pocket ID JWT validation — fetch JWKS, validate RS256 tokens, extract claims."""

import logging
import time
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Cache JWKS keys with TTL
_jwks_cache: dict[str, Any] | None = None
_jwks_cache_ttl: float = 0
_JWKS_TTL_SECONDS = 3600  # 1 hour
_JWKS_REQUEST_TIMEOUT = 3  # seconds — keep short so /me responds quickly


async def _fetch_jwks() -> dict[str, Any] | None:
    """Fetch JWKS from Pocket ID.

    Uses the internal URL (pocket-id:1411) so this works from inside Docker.
    """
    global _jwks_cache, _jwks_cache_ttl

    now = time.monotonic()
    if _jwks_cache is not None and now < _jwks_cache_ttl:
        return _jwks_cache

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
    jwks_path = jwks_uri.split("//", 1)[1].split("/", 1)[1] if "//" in jwks_uri else jwks_uri
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
    """Find a JWK by kid (key ID)."""
    keys = jwks.get("keys", [])
    if kid:
        for k in keys:
            if k.get("kid") == kid:
                return k
    # Fallback: return first key if no kid match
    if keys:
        return keys[0]
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
        from cryptography.hazmat.primitives.serialization import (
            load_der_public_key,
        )
        import base64

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


async def validate_pocket_id_token(access_token: str) -> dict[str, Any] | None:
    """
    Validate a Pocket ID access_token JWT.

    Returns the decoded claims dict if valid, None otherwise.
    """
    import base64

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

    # Fetch JWKS
    jwks = await _fetch_jwks()
    if not jwks:
        return None

    key = _find_key(jwks, kid)
    if not key:
        logger.warning("No matching JWK found (kid=%s)", kid)
        return None

    # Validate signature
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    if not _validate_rs256_signature(signing_input, signature_b64, key):
        logger.warning("JWT signature validation failed")
        return None

    # Decode and validate payload
    claims = _decode_jwt_payload(payload_b64)
    if not claims:
        return None

    # Validate exp
    now_ts = time.time()
    exp = claims.get("exp")
    if exp and now_ts > exp:
        logger.warning("JWT expired (exp=%s, now=%s)", exp, now_ts)
        return None

    return claims


def extract_user_claims(claims: dict[str, Any]) -> dict[str, Any]:
    """
    Extract user identity from Pocket ID JWT claims.

    Returns dict with keys: sub, groups, preferred_username, name
    """
    return {
        "sub": claims.get("sub", ""),
        "groups": claims.get("groups", []),
        "preferred_username": claims.get("preferred_username", ""),
        "name": claims.get("name", ""),
    }
