from flask import Blueprint, request, jsonify, g

from db import fetch_all, fetch_one, transaction
from auth import login_required


admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@admin_bp.get("/doctors/pending")
@login_required(allowed_roles=["admin"])
def get_pending_doctors():
    doctors = fetch_all("""
        select
            d.doctor_id,
            d.user_id,
            d.name,
            d.specialization,
            d.license_number,
            d.approval_status,
            d.settings_completed,
            d.rejection_reason,
            d.created_at,
            au.email,
            au.phone,
            au.status as account_status
        from public.doctor d
        join public.app_user au
          on au.user_id = d.user_id
        where d.approval_status = 'pending'
          and au.role = 'doctor'
        order by d.created_at desc
    """)

    return jsonify({
        "status": "ok",
        "message": "Pending doctor requests fetched.",
        "data": doctors
    })


@admin_bp.get("/doctors")
@login_required(allowed_roles=["admin"])
def get_all_doctors():
    approval_status = (request.args.get("approval_status") or "").strip().lower()

    base_query = """
        select
            d.doctor_id,
            d.user_id,
            d.name,
            d.specialization,
            d.license_number,
            d.approval_status,
            d.settings_completed,
            d.rejection_reason,
            d.approved_at,
            d.created_at,
            au.email,
            au.phone,
            au.status as account_status
        from public.doctor d
        join public.app_user au
          on au.user_id = d.user_id
        where au.role = 'doctor'
    """

    params = []

    if approval_status in ["pending", "approved", "rejected"]:
        base_query += " and d.approval_status = %s"
        params.append(approval_status)

    base_query += " order by d.created_at desc"

    doctors = fetch_all(base_query, tuple(params))

    return jsonify({
        "status": "ok",
        "message": "Doctors fetched.",
        "data": doctors
    })


@admin_bp.post("/doctors/<int:doctor_id>/approve")
@login_required(allowed_roles=["admin"])
def approve_doctor(doctor_id):
    existing_doctor = fetch_one("""
        select
            d.doctor_id,
            d.user_id,
            d.approval_status,
            au.status as account_status
        from public.doctor d
        join public.app_user au
          on au.user_id = d.user_id
        where d.doctor_id = %s
        limit 1
    """, (doctor_id,))

    if not existing_doctor:
        return jsonify({
            "status": "error",
            "message": "Doctor request not found."
        }), 404

    if existing_doctor["approval_status"] == "approved":
        return jsonify({
            "status": "error",
            "message": "Doctor is already approved."
        }), 409

    try:
        with transaction() as cursor:
            cursor.execute("""
                update public.doctor
                set
                    approval_status = 'approved',
                    approved_by = %s,
                    approved_at = now(),
                    rejection_reason = null
                where doctor_id = %s
                returning
                    doctor_id,
                    user_id,
                    name,
                    specialization,
                    license_number,
                    approval_status,
                    approved_at,
                    settings_completed
            """, (
                g.current_user["user_id"],
                doctor_id
            ))

            doctor = dict(cursor.fetchone())

            cursor.execute("""
                update public.app_user
                set
                    status = 'active',
                    updated_at = now()
                where user_id = %s
                returning
                    user_id,
                    email,
                    phone,
                    role,
                    status
            """, (
                doctor["user_id"],
            ))

            user = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Doctor approved successfully. The doctor can now log in.",
            "data": {
                "doctor": doctor,
                "user": user
            }
        })

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Doctor approval failed.",
            "error": str(error)
        }), 500


@admin_bp.post("/doctors/<int:doctor_id>/reject")
@login_required(allowed_roles=["admin"])
def reject_doctor(doctor_id):
    data = request.get_json(silent=True) or {}
    rejection_reason = (data.get("rejection_reason") or "").strip()

    if not rejection_reason:
        return jsonify({
            "status": "error",
            "message": "Rejection reason is required."
        }), 400

    existing_doctor = fetch_one("""
        select
            d.doctor_id,
            d.user_id,
            d.approval_status,
            au.status as account_status
        from public.doctor d
        join public.app_user au
          on au.user_id = d.user_id
        where d.doctor_id = %s
        limit 1
    """, (doctor_id,))

    if not existing_doctor:
        return jsonify({
            "status": "error",
            "message": "Doctor request not found."
        }), 404

    if existing_doctor["approval_status"] == "approved":
        return jsonify({
            "status": "error",
            "message": "Approved doctors cannot be rejected from this action."
        }), 409

    try:
        with transaction() as cursor:
            cursor.execute("""
                update public.doctor
                set
                    approval_status = 'rejected',
                    approved_by = %s,
                    approved_at = now(),
                    rejection_reason = %s
                where doctor_id = %s
                returning
                    doctor_id,
                    user_id,
                    name,
                    specialization,
                    license_number,
                    approval_status,
                    rejection_reason,
                    approved_at
            """, (
                g.current_user["user_id"],
                rejection_reason,
                doctor_id
            ))

            doctor = dict(cursor.fetchone())

            cursor.execute("""
                update public.app_user
                set
                    status = 'rejected',
                    updated_at = now()
                where user_id = %s
                returning
                    user_id,
                    email,
                    phone,
                    role,
                    status
            """, (
                doctor["user_id"],
            ))

            user = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Doctor request rejected successfully.",
            "data": {
                "doctor": doctor,
                "user": user
            }
        })

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Doctor rejection failed.",
            "error": str(error)
        }), 500


@admin_bp.get("/dashboard-summary")
@login_required(allowed_roles=["admin"])
def admin_dashboard_summary():
    summary = fetch_one("""
        select
            count(*) filter (where d.approval_status = 'pending') as pending_doctors,
            count(*) filter (where d.approval_status = 'approved') as approved_doctors,
            count(*) filter (where d.approval_status = 'rejected') as rejected_doctors,
            count(*) as total_doctors
        from public.doctor d
    """)

    return jsonify({
        "status": "ok",
        "message": "Admin dashboard summary fetched.",
        "data": summary
    })