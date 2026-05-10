import os
from pathlib import Path

from dotenv import load_dotenv

from db import fetch_one, execute_query
from auth import hash_password


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_PATH)


def seed_admin():
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    admin_phone = os.getenv("ADMIN_PHONE", "").strip()
    admin_password = os.getenv("ADMIN_PASSWORD", "")

    if not admin_email:
        raise RuntimeError("ADMIN_EMAIL is missing in .env")

    if not admin_password:
        raise RuntimeError("ADMIN_PASSWORD is missing in .env")

    existing_admin = fetch_one("""
        select user_id, email, role, status
        from public.app_user
        where lower(email) = %s
        limit 1
    """, (admin_email,))

    password_hash = hash_password(admin_password)

    if existing_admin:
        execute_query("""
            update public.app_user
            set
                password_hash = %s,
                phone = %s,
                role = 'admin',
                status = 'active',
                updated_at = now()
            where user_id = %s
        """, (
            password_hash,
            admin_phone,
            existing_admin["user_id"]
        ))

        print("Admin account already existed. Password/status updated.")
        print(f"Email: {admin_email}")
        return

    result = execute_query("""
        insert into public.app_user
        (email, phone, password_hash, role, status)
        values (%s, %s, %s, 'admin', 'active')
        returning user_id, email, role, status
    """, (
        admin_email,
        admin_phone,
        password_hash
    ))

    admin = result[0]

    print("Admin account created successfully.")
    print(f"User ID: {admin['user_id']}")
    print(f"Email: {admin['email']}")
    print(f"Role: {admin['role']}")
    print(f"Status: {admin['status']}")


if __name__ == "__main__":
    seed_admin()