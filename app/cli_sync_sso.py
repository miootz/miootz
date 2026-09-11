"""One-time CLI to backfill SSO data from Pocket ID for all users."""

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.database import async_session
from app.models.user import User
from app.services.pocket_id_client import get_user_by_id


async def sync_sso_data(dry_run: bool = False) -> None:
    """Fetch all users and update sso_display_name + sso_preferred_username from Pocket ID."""
    async with async_session() as db:
        result = await db.execute(select(User).where(User.pocket_id_sub.isnot(None)))
        users = result.scalars().all()
        if not users:
            print("No users with pocket_id_sub found.")
            return

        print(f"Found {len(users)} users with Pocket ID links.")

        updated = 0
        skipped = 0
        errors = 0

        for user in users:
            if not user.pocket_id_sub:
                continue
            try:
                sso = await get_user_by_id(user.pocket_id_sub)
                if sso is None:
                    print(
                        f"  [{user.id}] {user.pocket_id_sub}: not found in Pocket ID, skipping"
                    )
                    skipped += 1
                    continue

                display_name = sso.get("displayName")
                preferred_username = sso.get("preferredUsername") or sso.get("username")

                needs_update = (
                    user.sso_display_name != display_name
                    or user.sso_preferred_username != preferred_username
                )

                if not needs_update:
                    print(
                        f"  [{user.id}] {user.pocket_id_sub}: already up-to-date "
                        f"(display={user.sso_display_name!r}, username={user.sso_preferred_username!r})"
                    )
                    continue

                if dry_run:
                    print(
                        f"  [{user.id}] {user.pocket_id_sub}: WOULD update "
                        f"display_name {user.sso_display_name!r} -> {display_name!r}, "
                        f"preferred_username {user.sso_preferred_username!r} -> {preferred_username!r}"
                    )
                else:
                    user.sso_display_name = display_name
                    user.sso_preferred_username = preferred_username
                    updated += 1
                    print(
                        f"  [{user.id}] {user.pocket_id_sub}: updated "
                        f"display_name={display_name!r}, username={preferred_username!r}"
                    )
            except Exception as e:
                print(
                    f"  [{user.id}] {user.pocket_id_sub}: error - {e}", file=sys.stderr
                )
                errors += 1

        if not dry_run and updated > 0:
            await db.commit()

        print(f"\nDone: {updated} updated, {skipped} skipped, {errors} errors.")


def main():
    parser = argparse.ArgumentParser(description="Backfill SSO data from Pocket ID")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be updated without writing",
    )
    args = parser.parse_args()
    asyncio.run(sync_sso_data(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
