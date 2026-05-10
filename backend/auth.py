import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
import jwt
from flask import request, jsonify, g
from dotenv import load_dotenv


load_dotenv()

SECRET_KEY = os.getenv("APP_SECRET_KEY", "dev-secret-key")
JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "12"))


def hash_password(plain_password):
    if not plain_password:
        raise ValueError("Password is required.")

    password_bytes = plain_password.encode("utf-8")
    hashed = bcrypt.hashpw(password_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password, password_hash):
    if not plain_password or not password_hash:
        return False

    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        password_hash.encode("utf-8")
    )


def create_access_token(user):
    now = datetime.now(timezone.utc)

    payload = {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "role": user["role"],
        "status": user["status"],
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXPIRES_HOURS)).timestamp())
    }

    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_access_token(token):
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])


def login_required(allowed_roles=None):
    def decorator(route_function):
        @wraps(route_function)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")

            if not auth_header.startswith("Bearer "):
                return jsonify({
                    "status": "error",
                    "message": "Authorization token is missing."
                }), 401

            token = auth_header.replace("Bearer ", "").strip()

            try:
                payload = decode_access_token(token)
            except jwt.ExpiredSignatureError:
                return jsonify({
                    "status": "error",
                    "message": "Session expired. Please login again."
                }), 401
            except jwt.InvalidTokenError:
                return jsonify({
                    "status": "error",
                    "message": "Invalid token."
                }), 401

            if allowed_roles and payload.get("role") not in allowed_roles:
                return jsonify({
                    "status": "error",
                    "message": "You are not allowed to access this resource."
                }), 403

            g.current_user = payload
            return route_function(*args, **kwargs)

        return wrapper

    return decorator