from decimal import Decimal
from datetime import datetime, date, time

from flask import Blueprint, request, jsonify, g

from db import fetch_one, transaction
from auth import login_required


payment_bp = Blueprint(
    "payment",
    __name__,
    url_prefix="/api/appointments"
)


def clean_text(value):
    return (value or "").strip()


def make_json_safe(value):
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]

    if isinstance(value, dict):
        return {key: make_json_safe(item) for key, item in value.items()}

    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    return value


def get_appointment_with_access_context(appointment_id):
    return fetch_one("""
        select
            a.appointment_id,
            a.patient_id,
            a.doctor_id,
            a.doctor_hospital_id,
            a.pa_id,
            a.appointment_datetime,
            a.duration_minutes,
            a.fee_charged,
            a.fee_status,
            a.payment_method,
            a.payment_received_at,
            a.payment_received_by_user_id,
            a.discount_amount,
            a.refund_amount,
            a.payment_note,
            a.status,
            a.source,

            d.user_id as doctor_user_id,
            p.user_id as pa_user_id
        from public.appointment a
        left join public.doctor d
          on d.doctor_id = a.doctor_id
        left join public.pa p
          on p.pa_id = a.pa_id
        where a.appointment_id = %s
        limit 1
    """, (appointment_id,))


def can_update_payment(appointment):
    role = g.current_user["role"]
    user_id = g.current_user["user_id"]

    if role == "admin":
        return True

    if role == "doctor":
        return appointment["doctor_user_id"] == user_id

    if role == "pa":
        return appointment["pa_user_id"] == user_id

    return False


@payment_bp.post("/<int:appointment_id>/payment")
@login_required(allowed_roles=["admin", "doctor", "pa"])
def update_appointment_payment_unified(appointment_id):
    appointment = get_appointment_with_access_context(appointment_id)

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found."
        }), 404

    if not can_update_payment(appointment):
        return jsonify({
            "status": "error",
            "message": "You are not allowed to update payment for this appointment."
        }), 403

    if appointment["status"] in ["cancelled", "no_show"]:
        return jsonify({
            "status": "error",
            "message": "Cannot update payment for cancelled or no-show appointment."
        }), 409

    data = request.get_json(silent=True) or {}

    fee_status = clean_text(data.get("fee_status"))
    payment_method = clean_text(data.get("payment_method"))
    payment_note = clean_text(data.get("payment_note"))

    if fee_status not in ["pending", "paid", "waived"]:
        return jsonify({
            "status": "error",
            "message": "Fee status must be pending, paid, or waived."
        }), 400

    if payment_method == "":
        payment_method = None

    if payment_method and payment_method not in ["cash", "card", "bank_transfer", "online", "other"]:
        return jsonify({
            "status": "error",
            "message": "Invalid payment method."
        }), 400

    try:
        fee_charged = Decimal(str(data.get("fee_charged", appointment["fee_charged"] or 0)))
        discount_amount = Decimal(str(data.get("discount_amount", appointment["discount_amount"] or 0)))
        refund_amount = Decimal(str(data.get("refund_amount", appointment["refund_amount"] or 0)))
    except Exception:
        return jsonify({
            "status": "error",
            "message": "Fee, discount, and refund must be valid numbers."
        }), 400

    if fee_charged < 0 or discount_amount < 0 or refund_amount < 0:
        return jsonify({
            "status": "error",
            "message": "Amounts cannot be negative."
        }), 400

    if discount_amount > fee_charged:
        return jsonify({
            "status": "error",
            "message": "Discount cannot be greater than fee charged."
        }), 400

    try:
        with transaction() as cursor:
            cursor.execute("""
                update public.appointment
                set
                    fee_charged = %s,
                    fee_status = %s,
                    payment_method = %s,
                    payment_received_at = case
                        when %s = 'paid' then coalesce(payment_received_at, now())
                        else payment_received_at
                    end,
                    payment_received_by_user_id = case
                        when %s = 'paid' then %s
                        else payment_received_by_user_id
                    end,
                    discount_amount = %s,
                    refund_amount = %s,
                    payment_note = %s,
                    status = case
                        when %s = 'pending' and status = 'waiting' then 'pending_fee'
                        when %s in ('paid', 'waived') and status = 'pending_fee' then 'waiting'
                        else status
                    end,
                    updated_at = now()
                where appointment_id = %s
                returning
                    appointment_id,
                    fee_charged,
                    fee_status,
                    payment_method,
                    payment_received_at,
                    payment_received_by_user_id,
                    discount_amount,
                    refund_amount,
                    payment_note,
                    status,
                    updated_at
            """, (
                fee_charged,
                fee_status,
                payment_method,
                fee_status,
                fee_status,
                g.current_user["user_id"],
                discount_amount,
                refund_amount,
                payment_note,
                fee_status,
                fee_status,
                appointment_id
            ))

            updated_appointment = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.appointment_payment_log
                (
                    appointment_id,
                    doctor_id,
                    changed_by_user_id,
                    changed_by_role,
                    old_fee_status,
                    new_fee_status,
                    old_fee_charged,
                    new_fee_charged,
                    payment_method,
                    discount_amount,
                    refund_amount,
                    payment_note
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning
                    payment_log_id,
                    appointment_id,
                    doctor_id,
                    changed_by_user_id,
                    changed_by_role,
                    old_fee_status,
                    new_fee_status,
                    old_fee_charged,
                    new_fee_charged,
                    payment_method,
                    discount_amount,
                    refund_amount,
                    payment_note,
                    created_at
            """, (
                appointment_id,
                appointment["doctor_id"],
                g.current_user["user_id"],
                g.current_user["role"],
                appointment["fee_status"],
                fee_status,
                appointment["fee_charged"],
                fee_charged,
                payment_method,
                discount_amount,
                refund_amount,
                payment_note
            ))

            payment_log = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Payment updated successfully.",
            "data": make_json_safe({
                "appointment": updated_appointment,
                "payment_log": payment_log
            })
        })

    except Exception as error:
        print("UNIFIED PAYMENT UPDATE ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to update payment.",
            "error": str(error)
        }), 500