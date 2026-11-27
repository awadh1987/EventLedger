"""Clean production bootstrap: creates ONLY the platform SUPER_ADMIN account from env vars."""
import asyncio
import os

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models.base import Base
import app.models.accounting  # noqa: F401
import app.models.events  # noqa: F401
import app.models.events_extensions  # noqa: F401
import app.models.governance  # noqa: F401
import app.models.tenant  # noqa: F401
import app.models.venue  # noqa: F401
from app.models.users import User, UserType


def _require_env(name: str) -> str:
    val = (os.getenv(name) or getattr(settings, name, "") or "").strip()
    if not val:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return val


async def bootstrap_production() -> None:
    email = _require_env("SUPER_ADMIN_EMAIL").lower()
    phone = _require_env("SUPER_ADMIN_PHONE")
    password = _require_env("SUPER_ADMIN_PASSWORD")
    full_name = (os.getenv("SUPER_ADMIN_NAME") or settings.SUPER_ADMIN_NAME or "Platform Super Admin").strip()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        existing = (
            await db.execute(
                select(User).where(User.user_type == UserType.SUPER_ADMIN, (User.email == email) | (User.phone == phone))
            )
        ).scalar_one_or_none()
        if existing:
            print(f"Platform SUPER_ADMIN already exists: {existing.email or existing.phone}")
            return

        admin_user = User(
            tenant_id=None,
            user_type=UserType.SUPER_ADMIN,
            email=email,
            phone=phone,
            password_hash=hash_password(password),
            full_name=full_name,
            preferred_lang="en",
            is_2fa_enabled=True,
            is_active=True,
        )
        db.add(admin_user)
        await db.commit()
        print(f"Created platform SUPER_ADMIN: {email}")


if __name__ == "__main__":
    asyncio.run(bootstrap_production())
