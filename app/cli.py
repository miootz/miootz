import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.database import async_session
from app.models.user import User
from app.services.ldap_invite_users import provision_ldap_admin_user, sanitized_uid


async def create_admin(
    *,
    username: str,
    email: str,
    display_name: str | None,
    skip_ldap: bool,
) -> int:
    email_norm = email.strip()
    uid_key = sanitized_uid(username)
    if not uid_key:
        print("Error: username must yield a non-empty uid after sanitization.", file=sys.stderr)
        return 1

    async with async_session() as session:
        by_name = await session.execute(select(User).where(User.username == uid_key))
        by_mail = await session.execute(
            select(User).where(User.email == email_norm),
        )
        u_name = by_name.scalar_one_or_none()
        u_mail = by_mail.scalar_one_or_none()

        if u_name and u_mail and u_name.id != u_mail.id:
            print(
                "Error: username and email belong to different existing users.",
                file=sys.stderr,
            )
            return 1

        if u_name and u_name.email.strip().lower() != email_norm.lower():
            print(
                f"Error: user {uid_key!r} already exists with email {u_name.email!r}, not {email_norm!r}.",
                file=sys.stderr,
            )
            return 1

        existing = u_name or u_mail
        if existing:
            if existing.username != uid_key:
                print(
                    f"Error: email {email_norm!r} is already used by user {existing.username!r}.",
                    file=sys.stderr,
                )
                return 1
            if existing.is_admin:
                print(f"User {existing.username} is already an admin.")
                return 0
            existing.is_admin = True
            await session.commit()
            print(f"User {existing.username} promoted to admin (database only).")
            return 0

        ldap_password: str | None = None
        db_username = uid_key

        if not skip_ldap:
            try:
                db_username, ldap_password = await asyncio.to_thread(
                    provision_ldap_admin_user,
                    username=username,
                    email=email_norm,
                    display_name=display_name,
                )
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                return 1
            except Exception as e:
                print(f"Error: LDAP provisioning failed: {e}", file=sys.stderr)
                return 1

        new_admin = User(username=db_username, email=email_norm, is_admin=True)
        session.add(new_admin)
        await session.commit()
        print(f"Admin {db_username} created in the database.")

        if ldap_password is not None:
            print(
                "LDAP user created (groups: admins, members). "
                "Sign in to Authelia with this uid and password, then change the password."
            )
            print(f"  Authelia username (uid): {db_username}")
            print(f"  Temporary LDAP password: {ldap_password}")
        elif skip_ldap:
            print(
                "Skipped LDAP (--skip-ldap). Ensure this uid already exists in OpenLDAP "
                f"with group admins (uid={db_username!r})."
            )

    return 0


async def _async_main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Create an admin user in the API database and OpenLDAP (Authelia first factor). "
            "Requires LDAP_* env vars unless --skip-ldap (e.g. bootstrap uid=admin already in LDAP)."
        ),
    )
    parser.add_argument(
        "--username",
        required=True,
        help="Authelia / LDAP uid (e.g. admin); sanitized to match Remote-User",
    )
    parser.add_argument("--email", required=True, help="Email for the admin user")
    parser.add_argument(
        "--display-name",
        default="",
        help="Optional LDAP displayName (default: derived from email local part)",
    )
    parser.add_argument(
        "--skip-ldap",
        action="store_true",
        help="Only create the DB row; LDAP entry must already exist with matching uid",
    )
    args = parser.parse_args()

    display = (args.display_name or "").strip() or None
    return await create_admin(
        username=args.username,
        email=args.email,
        display_name=display,
        skip_ldap=args.skip_ldap,
    )


def main() -> None:
    raise SystemExit(asyncio.run(_async_main()))


if __name__ == "__main__":
    main()
