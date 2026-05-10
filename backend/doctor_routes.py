from flask import Blueprint, request, jsonify
from psycopg2.errors import UniqueViolation

from db import fetch_one, transaction
from auth import hash_password


doctor_bp = Blueprint("doctor", __name__, url_prefix="/api/doctors")


def clean_text(value):
    return (value or "").strip()


def clean_email(value):
    return (value or "").strip().lower()


@doctor_bp.post("/signup")
def doctor_signup():
    data = request.get_json(silent=True) or {}

    name = clean_text(data.get("name"))
    specialization = clean_text(data.get("specialization"))
    license_number = clean_text(data.get("license_number"))
    email = clean_email(data.get("email"))
    phone = clean_text(data.get("phone"))
    password = data.get("password") or ""

    if not name:
        return jsonify({
            "status": "error",
            "message": "Doctor name is required."
        }), 400

    if not specialization:
        return jsonify({
            "status": "error",
            "message": "Specialization is required."
        }), 400

    if not license_number:
        return jsonify({
            "status": "error",
            "message": "License number is required."
        }), 400

    if not email:
        return jsonify({
            "status": "error",
            "message": "Email is required."
        }), 400

    if len(password) < 8:
        return jsonify({
            "status": "error",
            "message": "Password must be at least 8 characters long."
        }), 400

    existing_user = fetch_one("""
        select user_id, email, role, status
        from public.app_user
        where lower(email) = %s
        limit 1
    """, (email,))

    if existing_user:
        return jsonify({
            "status": "error",
            "message": "An account with this email already exists."
        }), 409

    existing_license = fetch_one("""
        select doctor_id, license_number
        from public.doctor
        where lower(license_number) = lower(%s)
        limit 1
    """, (license_number,))

    if existing_license:
        return jsonify({
            "status": "error",
            "message": "A doctor with this license number already exists."
        }), 409

    password_hash = hash_password(password)

    try:
        with transaction() as cursor:
            cursor.execute("""
                insert into public.app_user
                (email, phone, password_hash, role, status)
                values (%s, %s, %s, 'doctor', 'pending')
                returning user_id, email, phone, role, status
            """, (
                email,
                phone,
                password_hash
            ))

            app_user = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.doctor
                (
                    user_id,
                    name,
                    specialization,
                    license_number,
                    approval_status,
                    settings_completed
                )
                values (%s, %s, %s, %s, 'pending', false)
                returning
                    doctor_id,
                    user_id,
                    name,
                    specialization,
                    license_number,
                    approval_status,
                    settings_completed,
                    created_at
            """, (
                app_user["user_id"],
                name,
                specialization,
                license_number
            ))

            doctor = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Doctor signup request submitted successfully. Please wait for admin approval.",
            "data": {
                "user": {
                    "user_id": app_user["user_id"],
                    "email": app_user["email"],
                    "phone": app_user["phone"],
                    "role": app_user["role"],
                    "status": app_user["status"]
                },
                "doctor": doctor
            }
        }), 201

    except UniqueViolation:
        return jsonify({
            "status": "error",
            "message": "Duplicate email or license number found."
        }), 409

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Doctor signup failed.",
            "error": str(error)
        }), 500


@doctor_bp.get("/signup-status")
def doctor_signup_status():
    email = clean_email(request.args.get("email"))

    if not email:
        return jsonify({
            "status": "error",
            "message": "Email is required."
        }), 400

    row = fetch_one("""
        select
            au.user_id,
            au.email,
            au.role,
            au.status as account_status,
            d.doctor_id,
            d.name,
            d.specialization,
            d.license_number,
            d.approval_status,
            d.rejection_reason,
            d.created_at
        from public.app_user au
        join public.doctor d
          on d.user_id = au.user_id
        where lower(au.email) = %s
          and au.role = 'doctor'
        limit 1
    """, (email,))

    if not row:
        return jsonify({
            "status": "error",
            "message": "No doctor signup request found for this email."
        }), 404

    return jsonify({
        "status": "ok",
        "message": "Doctor signup status fetched.",
        "data": row
    })