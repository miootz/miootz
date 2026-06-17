"""CLI to bootstrap a local admin user (DB only)."""

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.database import async_session
from app.models.user import User


async def create_admin_user(username: str) -> None:
    """Create a DB admin user (link to Pocket ID via /login/setup separately)."""
    username = username.strip()
    if not username:
        print("Error: username is required.", file=sys.stderr)
        sys.exit(1)

    async with async_session() as db:
        # Check if user already exists
        result = await db.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()
        if existing:
            existing.is_admin = True
            await db.commit()
            print(f"User '{username}' updated to admin.")
            return

        new_admin = User(username=username, is_admin=True)
        db.add(new_admin)
        await db.commit()
        print(f"Admin user '{username}' created (DB only).")
        print("Create the matching Pocket ID account via /login/setup and link by username.")


def main():
    parser = argparse.ArgumentParser(description="Create a local admin user")
    parser.add_argument("--username", required=True, help="Username for the admin user")
    args = parser.parse_args()

    asyncio.run(create_admin_user(args.username))


if __name__ == "__main__":
    main()
