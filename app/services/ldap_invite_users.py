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

from ldap3 import MODIFY_ADD, SUBTREE, Connection, Server
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.hashed import HASHED_SALTED_SHA, hashed

from app.core.config import settings

logger = logging.getLogger(__name__)


def _sanitize_uid(local_part: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_]", "_", local_part).strip("_")
    return s[:48] if s else "user"


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


def provision_ldap_invite_user(*, email: str, display_name: str | None) -> tuple[str, str]:
    """
    Create an inetOrgPerson under ou=people and add them to configured groups.

    Returns (uid, plaintext_password).
    """
    uri = _ldap_uri()
    base = _base_dn()
    bind_dn = (settings.LDAP_BIND_DN or "").strip()
    bind_pw = settings.LDAP_BIND_PASSWORD or ""
    if not uri or not base or not bind_dn or not bind_pw:
        raise ValueError("LDAP_URI, LDAP_BASE_DN, LDAP_BIND_DN, and LDAP_BIND_PASSWORD must be set")

    local = email.split("@", 1)[0] if "@" in email else email
    base_uid = _sanitize_uid(local)
    password = secrets.token_urlsafe(20)
    enc_pw = hashed(HASHED_SALTED_SHA, password)

    display = (display_name or "").strip() or local.replace(".", " ").replace("_", " ").title()
    sn = display.split()[-1] if display.split() else base_uid

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

        uid = base_uid
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
            uid = f"{base_uid}_{n}"
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

        for cn in _invite_group_cns():
            gdn = _group_dn_for_cn(cn)
            if conn.modify(gdn, {"member": [(MODIFY_ADD, [user_dn])]}):
                continue
            # 20 = entryAlreadyExists / attributeOrValueExists for duplicate member
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
