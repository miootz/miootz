import asyncio
import argparse
from sqlalchemy import select
from app.core.database import async_session
from app.models.user import User


async def create_admin(username: str, email: str):
    async with async_session() as session:
        # Check if user exists
        result = await session.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()

        if user:
            print(f"User {username} already exists.")
            return

        new_admin = User(username=username, email=email, is_admin=True)
        session.add(new_admin)
        await session.commit()
        print(f"Admin {username} created successfully.")


async def main():
    parser = argparse.ArgumentParser(description="Create initial admin user")
    parser.add_argument("--username", required=True, help="Username for the admin")
    parser.add_argument("--email", required=True, help="Email for the admin")
    args = parser.parse_args()

    await create_admin(args.username, args.email)


if __name__ == "__main__":
    asyncio.run(main())
