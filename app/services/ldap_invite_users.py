"""
Create OpenLDAP users for Authelia first-factor auth (invite verification).

Uses SSHA for userPassword (OpenLDAP default). Authelia binds against LDAP in real time,
so users can sign in immediately after provisioning.
"""

from __future__ import annotations

import logging
import re
import secrets
from typing import Any

from ldap3 import MODIFY_ADD, MODIFY_REPLACE, SUBTREE, Connection, Server
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.hashed import HASHED_SALTED_SHA, hashed

from app.core.config import settings

logger = logging.getLogger(__name__)


def _sanitize_uid(local_part: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_]", "_", local_part).strip("_")
    return s[:48] if s else "user"


def sanitized_uid(value: str) -> str:
    """Normalize a string to a safe LDAP ``uid`` (same rules as invite-derived usernames)."""
    return _sanitize_uid(value.strip())


def _ldap_uri() -> str:
    return (settings.LDAP_URI or "").strip()


def _base_dn() -> str:
    return (settings.LDAP_BASE_DN or "").strip()


def _users_search_base() -> str:
    ou = (settings.LDAP_USERS_OU or "ou=people").strip()
    return f"{ou},{_base_dn()}"


def _group_dn_for_cn(cn: str) -> str:
    gou = (settings.LDAP_GROUPS_OU or "ou=groups").strip()
    return f"cn={cn.strip()},{gou},{_base_dn()}"


def _invite_group_cns() -> list[str]:
    raw = (settings.LDAP_INVITE_GROUP_CNS or settings.AUTHELIA_INVITE_DEFAULT_GROUPS or "").strip()
    if not raw:
        return ["members"]
    return [g.strip() for g in raw.split(",") if g.strip()]


def _ldap_admin_group_cns() -> list[str]:
    """Groups for CLI-created admins (Authelia Remote-Groups must include admins)."""
    return list(dict.fromkeys(["admins", "members"]))


def _provision_ldap_inetorgperson(
    *,
    email: str,
    display_name: str | None,
    uid_base: str,
    group_cns: list[str],
) -> tuple[str, str]:
    """
    Create inetOrgPerson under ou=people and add to the given group CNs.

    ``uid_base`` must already be sanitized; it is uniquified if taken.

    Returns (uid, plaintext_password).
    """
    uri = _ldap_uri()
    base = _base_dn()
    bind_dn = (settings.LDAP_BIND_DN or "").strip()
    bind_pw = settings.LDAP_BIND_PASSWORD or ""
    if not uri or not base or not bind_dn or not bind_pw:
        raise ValueError("LDAP_URI, LDAP_BASE_DN, LDAP_BIND_DN, and LDAP_BIND_PASSWORD must be set")

    password = secrets.token_urlsafe(20)
    enc_pw = hashed(HASHED_SALTED_SHA, password)

    local = email.split("@", 1)[0] if "@" in email else email
    display = (display_name or "").strip() or local.replace(".", " ").replace("_", " ").title()
    sn = display.split()[-1] if display.split() else uid_base

    mail_norm = email.strip().lower()
    users_base = _users_search_base()

    server = Server(uri, connect_timeout=10)
    conn = Connection(server, user=bind_dn, password=bind_pw, auto_bind=True)

    try:
        esc_mail = escape_filter_chars(mail_norm)
        conn.search(
            search_base=users_base,
            search_filter=f"(mail={esc_mail})",
            search_scope=SUBTREE,
            attributes=["uid"],
        )
        if conn.entries:
            raise ValueError(f"Email already registered in LDAP: {email}")

        uid = uid_base
        n = 1
        while True:
            esc_uid = escape_filter_chars(uid)
            conn.search(
                search_base=users_base,
                search_filter=f"(uid={esc_uid})",
                search_scope=SUBTREE,
                attributes=["uid"],
            )
            if not conn.entries:
                break
            uid = f"{uid_base}_{n}"
            n += 1

        user_dn = f"uid={uid},{users_base}"
        attrs: dict[str, Any] = {
            "objectClass": ["inetOrgPerson", "organizationalPerson", "person", "top"],
            "uid": uid,
            "cn": display,
            "sn": sn,
            "displayName": display,
            "mail": email.strip(),
            "userPassword": enc_pw,
        }

        if not conn.add(user_dn, attributes=attrs):
            raise RuntimeError(f"LDAP add failed: {conn.result}")

        for cn in group_cns:
            gdn = _group_dn_for_cn(cn)
            if conn.modify(gdn, {"member": [(MODIFY_ADD, [user_dn])]}):
                continue
            if (conn.result or {}).get("result") == 20:
                continue
            logger.warning(
                "Could not add %s to group %s: %s",
                user_dn,
                gdn,
                conn.result,
            )
    finally:
        conn.unbind()

    logger.info("Provisioned LDAP user %r for email %r", uid, email)
    return uid, password


def ldap_replace_user_password(*, uid: str, plaintext: str) -> None:
    """
    Set ``userPassword`` for ``uid=...`` under the configured users OU (admin bind).

    Used after invite verification so the user chooses their password instead of
    receiving a random one by email.
    """
    uri = _ldap_uri()
    base = _base_dn()
    bind_dn = (settings.LDAP_BIND_DN or "").strip()
    bind_pw = settings.LDAP_BIND_PASSWORD or ""
    if not uri or not base or not bind_dn or not bind_pw:
        raise ValueError("LDAP_URI, LDAP_BASE_DN, LDAP_BIND_DN, and LDAP_BIND_PASSWORD must be set")

    users_base = _users_search_base()
    user_dn = f"uid={uid},{users_base}"
    enc_pw = hashed(HASHED_SALTED_SHA, plaintext)

    server = Server(uri, connect_timeout=10)
    conn = Connection(server, user=bind_dn, password=bind_pw, auto_bind=True)
    try:
        if not conn.modify(user_dn, {"userPassword": [(MODIFY_REPLACE, [enc_pw])]}):
            raise RuntimeError(f"LDAP password modify failed: {conn.result}")
    finally:
        conn.unbind()

    logger.info("Updated LDAP password for uid %r", uid)


def provision_ldap_invite_user(*, email: str, display_name: str | None) -> tuple[str, str]:
    """
    Create an inetOrgPerson under ou=people and add them to configured groups.

    Returns (uid, plaintext_password).
    """
    local = email.split("@", 1)[0] if "@" in email else email
    base_uid = _sanitize_uid(local)
    return _provision_ldap_inetorgperson(
        email=email,
        display_name=display_name,
        uid_base=base_uid,
        group_cns=_invite_group_cns(),
    )


def provision_ldap_admin_user(*, username: str, email: str, display_name: str | None) -> tuple[str, str]:
    """
    Create an LDAP user suitable for app admins (``admins`` + ``members`` groups).

    ``username`` is sanitized to the LDAP ``uid`` (must match Authelia ``Remote-User``).

    Returns (uid, plaintext_password).
    """
    uid_base = _sanitize_uid(username.strip())
    if not uid_base:
        raise ValueError("username must yield a non-empty uid after sanitization")
    return _provision_ldap_inetorgperson(
        email=email,
        display_name=display_name,
        uid_base=uid_base,
        group_cns=_ldap_admin_group_cns(),
    )
