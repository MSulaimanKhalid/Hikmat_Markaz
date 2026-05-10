from flask import Blueprint, request, jsonify, g

from db import fetch_one
from auth import verify_password, create_access_token, login_required


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({
            "status": "error",
            "message": "Email and password are required."
        }), 400

    user = fetch_one("""
        select
            user_id,
            email,
            phone,
            password_hash,
            role,
            status,
            created_at
        from public.app_user
        where lower(email) = %s
        limit 1
    """, (email,))

    if not user:
        return jsonify({
            "status": "error",
            "message": "Invalid email or password."
        }), 401

    if not verify_password(password, user["password_hash"]):
        return jsonify({
            "status": "error",
            "message": "Invalid email or password."
        }), 401

    if user["status"] != "active":
        return jsonify({
            "status": "error",
            "message": f"Your account is currently {user['status']}."
        }), 403

    token = create_access_token(user)

    return jsonify({
        "status": "ok",
        "message": "Login successful.",
        "token": token,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "phone": user["phone"],
            "role": user["role"],
            "status": user["status"]
        }
    })


@auth_bp.get("/me")
@login_required()
def me():
    return jsonify({
        "status": "ok",
        "message": "Authenticated user fetched.",
        "user": {
            "user_id": g.current_user["user_id"],
            "email": g.current_user.get("email"),
            "role": g.current_user["role"],
            "status": g.current_user["status"]
        }
    })


@auth_bp.get("/admin-only-test")
@login_required(allowed_roles=["admin"])
def admin_only_test():
    return jsonify({
        "status": "ok",
        "message": "Admin authorization working.",
        "user": g.current_user
    })