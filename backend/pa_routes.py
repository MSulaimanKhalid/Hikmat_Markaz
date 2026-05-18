from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from flask import Blueprint, request, jsonify, g

from db import fetch_one, fetch_all, execute_query, transaction
from auth import login_required, hash_password


pa_bp = Blueprint("pa", __name__)


def clean_text(value):
    return (value or "").strip()


def clean_email(value):
    return (value or "").strip().lower()


def make_json_safe(value):
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]

    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}

    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, UUID):
        return str(value)

    return value


def first_row(rows):
    return rows[0] if rows else None


def get_current_doctor():
    return fetch_one("""
        select
            doctor_id,
            user_id,
            name,
            specialization,
            approval_status,
            settings_completed
        from public.doctor
        where user_id = %s
        limit 1
    """, (g.current_user["user_id"],))


def require_approved_doctor():
    doctor = get_current_doctor()

    if not doctor:
        return None, ({
            "status": "error",
            "message": "Doctor profile not found."
        }, 404)

    if doctor["approval_status"] != "approved":
        return None, ({
            "status": "error",
            "message": "Doctor account is not approved yet."
        }, 403)

    return doctor, None


def get_doctor_hospital(doctor_id, hospital_id):
    return fetch_one("""
        select
            id,
            doctor_id,
            name,
            city,
            is_active
        from public.doctor_hospital
        where id = %s
          and doctor_id = %s
          and is_active = true
        limit 1
    """, (
        hospital_id,
        doctor_id
    ))


def get_pa_by_cnic(cnic):
    return fetch_one("""
        select
            p.pa_id,
            p.user_id,
            p.cnic,
            p.full_name,
            p.phone,
            p.is_active,
            au.email,
            au.status as account_status
        from public.pa p
        left join public.app_user au
          on au.user_id = p.user_id
        where p.cnic = %s
        limit 1
    """, (cnic,))


def get_active_doctor_pa_link(doctor_id, pa_id, hospital_id):
    return fetch_one("""
        select
            doctor_pa_id,
            doctor_id,
            pa_id,
            doctor_hospital_id,
            is_active
        from public.doctor_pa
        where doctor_id = %s
          and pa_id = %s
          and doctor_hospital_id = %s
          and is_active = true
        limit 1
    """, (
        doctor_id,
        pa_id,
        hospital_id
    ))


def create_doctor_pa_link(doctor_id, pa_id, hospital_id, invite_id=None):
    rows = execute_query("""
        insert into public.doctor_pa
        (
            doctor_id,
            pa_id,
            doctor_hospital_id,
            invite_id,
            is_active
        )
        values (%s, %s, %s, %s, true)
        returning
            doctor_pa_id,
            doctor_id,
            pa_id,
            doctor_hospital_id,
            invite_id,
            is_active,
            created_at
    """, (
        doctor_id,
        pa_id,
        hospital_id,
        invite_id
    ))

    return first_row(rows)


@pa_bp.get("/api/doctor/pa-links")
@login_required(allowed_roles=["doctor"])
def get_doctor_pa_links():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    links = fetch_all("""
        select
            dp.doctor_pa_id,
            dp.doctor_id,
            dp.pa_id,
            dp.doctor_hospital_id,
            dp.is_active,
            dp.created_at,
            p.cnic,
            p.full_name,
            p.phone,
            au.email,
            au.status as account_status,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.doctor_pa dp
        join public.pa p
          on p.pa_id = dp.pa_id
        left join public.app_user au
          on au.user_id = p.user_id
        join public.doctor_hospital dh
          on dh.id = dp.doctor_hospital_id
        where dp.doctor_id = %s
          and dp.is_active = true
        order by dp.created_at desc
    """, (doctor["doctor_id"],))

    return jsonify({
        "status": "ok",
        "message": "Doctor PA links fetched.",
        "data": make_json_safe(links)
    })


@pa_bp.get("/api/doctor/pa-invites")
@login_required(allowed_roles=["doctor"])
def get_doctor_pa_invites():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    invites = fetch_all("""
        select
            pi.invite_id,
            pi.doctor_id,
            pi.doctor_hospital_id,
            pi.invited_cnic,
            pi.invited_email,
            pi.invite_token,
            pi.status,
            pi.accepted_by_pa_id,
            pi.accepted_at,
            pi.created_at,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.pa_invite pi
        join public.doctor_hospital dh
          on dh.id = pi.doctor_hospital_id
        where pi.doctor_id = %s
        order by pi.created_at desc
    """, (doctor["doctor_id"],))

    return jsonify({
        "status": "ok",
        "message": "PA invites fetched.",
        "data": make_json_safe(invites)
    })


@pa_bp.post("/api/doctor/pa-invites")
@login_required(allowed_roles=["doctor"])
def create_pa_invite_or_link():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    cnic = clean_text(data.get("cnic"))
    invited_email = clean_email(data.get("email"))
    hospital_id = data.get("doctor_hospital_id")

    if not cnic:
        return jsonify({
            "status": "error",
            "message": "PA CNIC is required."
        }), 400

    if not invited_email:
        return jsonify({
            "status": "error",
            "message": "PA email is required."
        }), 400

    try:
        hospital_id = int(hospital_id)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Valid hospital is required."
        }), 400

    hospital = get_doctor_hospital(doctor["doctor_id"], hospital_id)

    if not hospital:
        return jsonify({
            "status": "error",
            "message": "Hospital/clinic not found for this doctor."
        }), 404

    existing_pa = get_pa_by_cnic(cnic)

    if existing_pa:
        existing_link = get_active_doctor_pa_link(
            doctor["doctor_id"],
            existing_pa["pa_id"],
            hospital_id
        )

        if existing_link:
            return jsonify({
                "status": "error",
                "message": "This PA is already linked with this doctor and hospital."
            }), 409

        link = create_doctor_pa_link(
            doctor["doctor_id"],
            existing_pa["pa_id"],
            hospital_id
        )

        return jsonify({
            "status": "ok",
            "message": "Existing PA found by CNIC and linked successfully.",
            "mode": "linked_existing_pa",
            "data": make_json_safe({
                "pa": existing_pa,
                "link": link,
                "hospital": hospital
            })
        }), 201

    pending_invite = fetch_one("""
        select
            invite_id,
            invite_token,
            status
        from public.pa_invite
        where doctor_id = %s
          and doctor_hospital_id = %s
          and invited_cnic = %s
          and status = 'pending'
        limit 1
    """, (
        doctor["doctor_id"],
        hospital_id,
        cnic
    ))

    if pending_invite:
        return jsonify({
            "status": "error",
            "message": "A pending invite already exists for this CNIC and hospital.",
            "data": make_json_safe(pending_invite)
        }), 409

    rows = execute_query("""
        insert into public.pa_invite
        (
            doctor_id,
            doctor_hospital_id,
            invited_cnic,
            invited_email,
            status
        )
        values (%s, %s, %s, %s, 'pending')
        returning
            invite_id,
            doctor_id,
            doctor_hospital_id,
            invited_cnic,
            invited_email,
            invite_token,
            status,
            created_at
    """, (
        doctor["doctor_id"],
        hospital_id,
        cnic,
        invited_email
    ))

    invite = first_row(rows)

    return jsonify({
        "status": "ok",
        "message": "PA is not registered yet. Invite created successfully.",
        "mode": "invite_created",
        "data": make_json_safe({
            "invite": invite,
            "hospital": hospital
        })
    }), 201


@pa_bp.get("/api/pa/invites/<invite_token>")
def get_public_pa_invite(invite_token):
    invite = fetch_one("""
        select
            pi.invite_id,
            pi.doctor_id,
            pi.doctor_hospital_id,
            pi.invited_cnic,
            pi.invited_email,
            pi.invite_token,
            pi.status,
            pi.created_at,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.pa_invite pi
        join public.doctor d
          on d.doctor_id = pi.doctor_id
        join public.doctor_hospital dh
          on dh.id = pi.doctor_hospital_id
        where pi.invite_token = %s
        limit 1
    """, (invite_token,))

    if not invite:
        return jsonify({
            "status": "error",
            "message": "Invite not found."
        }), 404

    return jsonify({
        "status": "ok",
        "message": "PA invite fetched.",
        "data": make_json_safe(invite)
    })


@pa_bp.post("/api/pa/invites/<invite_token>/accept")
def accept_pa_invite(invite_token):
    data = request.get_json(silent=True) or {}

    full_name = clean_text(data.get("full_name"))
    phone = clean_text(data.get("phone"))
    email = clean_email(data.get("email"))
    password = data.get("password") or ""

    if not full_name:
        return jsonify({
            "status": "error",
            "message": "Full name is required."
        }), 400

    if not phone:
        return jsonify({
            "status": "error",
            "message": "Phone is required."
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

    invite = fetch_one("""
        select
            invite_id,
            doctor_id,
            doctor_hospital_id,
            invited_cnic,
            invited_email,
            status
        from public.pa_invite
        where invite_token = %s
        limit 1
    """, (invite_token,))

    if not invite:
        return jsonify({
            "status": "error",
            "message": "Invite not found."
        }), 404

    if invite["status"] != "pending":
        return jsonify({
            "status": "error",
            "message": f"This invite is already {invite['status']}."
        }), 409

    if email != invite["invited_email"]:
        return jsonify({
            "status": "error",
            "message": "Email must match the invited email."
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

    existing_pa = get_pa_by_cnic(invite["invited_cnic"])

    if existing_pa:
        return jsonify({
            "status": "error",
            "message": "A PA with this CNIC already exists. Ask the doctor to link the existing PA instead."
        }), 409

    password_hash = hash_password(password)

    try:
        with transaction() as cursor:
            cursor.execute("""
                insert into public.app_user
                (
                    email,
                    phone,
                    password_hash,
                    role,
                    status
                )
                values (%s, %s, %s, 'pa', 'active')
                returning
                    user_id,
                    email,
                    phone,
                    role,
                    status
            """, (
                email,
                phone,
                password_hash
            ))

            app_user = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.pa
                (
                    user_id,
                    cnic,
                    full_name,
                    phone,
                    is_active
                )
                values (%s, %s, %s, %s, true)
                returning
                    pa_id,
                    user_id,
                    cnic,
                    full_name,
                    phone,
                    is_active,
                    created_at
            """, (
                app_user["user_id"],
                invite["invited_cnic"],
                full_name,
                phone
            ))

            pa = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.doctor_pa
                (
                    doctor_id,
                    pa_id,
                    doctor_hospital_id,
                    invite_id,
                    is_active
                )
                values (%s, %s, %s, %s, true)
                returning
                    doctor_pa_id,
                    doctor_id,
                    pa_id,
                    doctor_hospital_id,
                    invite_id,
                    is_active,
                    created_at
            """, (
                invite["doctor_id"],
                pa["pa_id"],
                invite["doctor_hospital_id"],
                invite["invite_id"]
            ))

            link = dict(cursor.fetchone())

            cursor.execute("""
                update public.pa_invite
                set
                    status = 'accepted',
                    accepted_by_pa_id = %s,
                    accepted_at = now(),
                    updated_at = now()
                where invite_id = %s
                returning
                    invite_id,
                    status,
                    accepted_by_pa_id,
                    accepted_at
            """, (
                pa["pa_id"],
                invite["invite_id"]
            ))

            updated_invite = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "PA registration completed successfully. You can now login.",
            "data": make_json_safe({
                "user": app_user,
                "pa": pa,
                "link": link,
                "invite": updated_invite
            })
        }), 201

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "PA registration failed.",
            "error": str(error)
        }), 500