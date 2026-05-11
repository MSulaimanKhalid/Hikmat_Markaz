from datetime import date, datetime, time, timedelta
from decimal import Decimal

from flask import Blueprint, request, jsonify, g

from db import fetch_one, fetch_all, execute_query, transaction
from auth import login_required


doctor_appointment_finance_bp = Blueprint(
    "doctor_appointment_finance",
    __name__,
    url_prefix="/api/doctor"
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


def parse_date_or_none(value):
    if not value:
        return None

    return date.fromisoformat(value)


def get_default_date_range():
    today = datetime.now().date()
    date_from = today - timedelta(days=30)
    date_to = today + timedelta(days=14)

    return date_from, date_to


def get_current_doctor():
    return fetch_one("""
        select
            doctor_id,
            user_id,
            name,
            specialization,
            license_number,
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


def build_appointment_filters(doctor_id, args):
    date_from_raw = args.get("date_from")
    date_to_raw = args.get("date_to")

    try:
        date_from = parse_date_or_none(date_from_raw)
        date_to = parse_date_or_none(date_to_raw)
    except ValueError:
        raise ValueError("Date filters must be valid YYYY-MM-DD values.")

    if not date_from or not date_to:
        date_from, date_to = get_default_date_range()

    start_dt = datetime.combine(date_from, time(0, 0))
    end_dt = datetime.combine(date_to + timedelta(days=1), time(0, 0))

    where_parts = [
        "a.doctor_id = %s",
        "a.appointment_datetime >= %s",
        "a.appointment_datetime < %s"
    ]

    params = [
        doctor_id,
        start_dt,
        end_dt
    ]

    doctor_hospital_id = args.get("doctor_hospital_id")
    pa_id = args.get("pa_id")
    status = args.get("status")
    fee_status = args.get("fee_status")
    source = args.get("source")
    search = clean_text(args.get("search"))

    if doctor_hospital_id:
        where_parts.append("a.doctor_hospital_id = %s")
        params.append(int(doctor_hospital_id))

    if pa_id:
        where_parts.append("a.pa_id = %s")
        params.append(int(pa_id))

    if status and status != "all":
        where_parts.append("a.status = %s")
        params.append(status)

    if fee_status and fee_status != "all":
        where_parts.append("a.fee_status = %s")
        params.append(fee_status)

    if source and source != "all":
        where_parts.append("a.source = %s")
        params.append(source)

    if search:
        where_parts.append("""
            (
                p.name ilike %s
                or p.cnic ilike %s
                or coalesce(p.phone, '') ilike %s
            )
        """)
        search_value = f"%{search}%"
        params.extend([search_value, search_value, search_value])

    where_clause = " and ".join(where_parts)

    return where_clause, tuple(params), date_from, date_to


def get_appointment_for_doctor(doctor_id, appointment_id):
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
            a.priority_level,
            a.priority_reason,
            a.actual_start,
            a.actual_end,
            a.notes,
            a.created_at,
            a.updated_at,

            p.name as patient_name,
            p.cnic as patient_cnic,
            p.gender as patient_gender,
            p.phone as patient_phone,
            p.email as patient_email,

            dh.name as hospital_name,
            dh.city as hospital_city,
            dh.address as hospital_address,

            pa.full_name as pa_name,
            au.email as pa_email
        from public.appointment a
        join public.patient p
          on p.patient_id = a.patient_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.pa pa
          on pa.pa_id = a.pa_id
        left join public.app_user au
          on au.user_id = pa.user_id
        where a.appointment_id = %s
          and a.doctor_id = %s
        limit 1
    """, (
        appointment_id,
        doctor_id
    ))


@doctor_appointment_finance_bp.get("/appointments/filters")
@login_required(allowed_roles=["doctor"])
def get_doctor_appointment_filters():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    hospitals = fetch_all("""
        select
            id,
            name,
            city,
            address
        from public.doctor_hospital
        where doctor_id = %s
          and is_active = true
        order by name
    """, (doctor["doctor_id"],))

    pas = fetch_all("""
        select distinct
            p.pa_id,
            p.full_name,
            p.cnic,
            p.phone,
            au.email,
            dh.id as doctor_hospital_id,
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
        order by p.full_name
    """, (doctor["doctor_id"],))

    return jsonify({
        "status": "ok",
        "message": "Doctor appointment filters fetched.",
        "data": make_json_safe({
            "hospitals": hospitals,
            "pas": pas
        })
    })


@doctor_appointment_finance_bp.get("/appointments")
@login_required(allowed_roles=["doctor"])
def get_doctor_appointments():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    try:
        where_clause, params, date_from, date_to = build_appointment_filters(
            doctor["doctor_id"],
            request.args
        )
    except ValueError as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 400

    appointments = fetch_all(f"""
        select
            a.appointment_id,
            a.appointment_datetime,
            a.duration_minutes,
            a.fee_charged,
            a.fee_status,
            a.payment_method,
            a.payment_received_at,
            a.discount_amount,
            a.refund_amount,
            a.status,
            a.source,
            a.priority_level,
            a.actual_start,
            a.actual_end,
            a.notes,

            p.name as patient_name,
            p.cnic as patient_cnic,
            p.phone as patient_phone,

            dh.name as hospital_name,
            dh.city as hospital_city,

            pa.full_name as pa_name,
            au.email as pa_email,

            dg.diagnosis_text,
            dg.treatment_plan
        from public.appointment a
        join public.patient p
          on p.patient_id = a.patient_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.pa pa
          on pa.pa_id = a.pa_id
        left join public.app_user au
          on au.user_id = pa.user_id
        left join public.visit v
          on v.appointment_id = a.appointment_id
        left join public.diagnosis dg
          on dg.visit_id = v.visit_id
        where {where_clause}
        order by a.appointment_datetime desc
    """, params)

    return jsonify({
        "status": "ok",
        "message": "Doctor appointments fetched.",
        "data": make_json_safe({
            "date_from": date_from,
            "date_to": date_to,
            "appointments": appointments
        })
    })


@doctor_appointment_finance_bp.get("/appointments/<int:appointment_id>")
@login_required(allowed_roles=["doctor"])
def get_doctor_appointment_detail(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

    visit = fetch_one("""
        select
            visit_id,
            appointment_id,
            patient_id,
            doctor_id,
            started_at,
            completed_at,
            clinical_notes,
            bp,
            pulse,
            temperature,
            weight
        from public.visit
        where appointment_id = %s
        limit 1
    """, (appointment_id,))

    diagnosis = None
    dynamic_values = []

    if visit:
        diagnosis = fetch_one("""
            select
                diagnosis_id,
                visit_id,
                appointment_id,
                doctor_id,
                patient_id,
                diagnosis_text,
                treatment_plan,
                follow_up_notes,
                created_at,
                updated_at
            from public.diagnosis
            where visit_id = %s
            limit 1
        """, (visit["visit_id"],))

        dynamic_values = fetch_all("""
            select
                vfv.field_value_id,
                vfv.visit_id,
                vfv.field_id,
                vfv.value_text,
                dff.field_label,
                dff.field_type
            from public.visit_field_value vfv
            left join public.doctor_form_field dff
              on dff.field_id = vfv.field_id
            where vfv.visit_id = %s
            order by dff.display_order, vfv.field_value_id
        """, (visit["visit_id"],))

    payment_logs = fetch_all("""
        select
            payment_log_id,
            appointment_id,
            doctor_id,
            changed_by_user_id,
            old_fee_status,
            new_fee_status,
            old_fee_charged,
            new_fee_charged,
            payment_method,
            discount_amount,
            refund_amount,
            payment_note,
            created_at
        from public.appointment_payment_log
        where appointment_id = %s
        order by created_at desc
    """, (appointment_id,))

    return jsonify({
        "status": "ok",
        "message": "Appointment detail fetched.",
        "data": make_json_safe({
            "appointment": appointment,
            "visit": visit,
            "diagnosis": diagnosis,
            "dynamic_values": dynamic_values,
            "payment_logs": payment_logs
        })
    })


@doctor_appointment_finance_bp.post("/appointments/<int:appointment_id>/cancel")
@login_required(allowed_roles=["doctor"])
def cancel_doctor_appointment(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

    if appointment["status"] in ["completed", "in_consultation"]:
        return jsonify({
            "status": "error",
            "message": "Completed or in-consultation appointments cannot be cancelled."
        }), 409

    data = request.get_json(silent=True) or {}
    reason = clean_text(data.get("reason"))

    rows = execute_query("""
        update public.appointment
        set
            status = 'cancelled',
            notes = case
                when %s = '' then notes
                else concat(coalesce(notes, ''), E'\nCancellation reason: ', %s)
            end,
            updated_at = now()
        where appointment_id = %s
          and doctor_id = %s
        returning
            appointment_id,
            status,
            notes,
            updated_at
    """, (
        reason,
        reason,
        appointment_id,
        doctor["doctor_id"]
    ))

    return jsonify({
        "status": "ok",
        "message": "Appointment cancelled.",
        "data": make_json_safe(rows[0] if rows else None)
    })


@doctor_appointment_finance_bp.post("/appointments/<int:appointment_id>/no-show")
@login_required(allowed_roles=["doctor"])
def mark_doctor_appointment_no_show(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

    if appointment["status"] in ["completed", "in_consultation"]:
        return jsonify({
            "status": "error",
            "message": "Completed or in-consultation appointments cannot be marked no-show."
        }), 409

    rows = execute_query("""
        update public.appointment
        set
            status = 'no_show',
            updated_at = now()
        where appointment_id = %s
          and doctor_id = %s
        returning
            appointment_id,
            status,
            updated_at
    """, (
        appointment_id,
        doctor["doctor_id"]
    ))

    return jsonify({
        "status": "ok",
        "message": "Appointment marked as no-show.",
        "data": make_json_safe(rows[0] if rows else None)
    })


@doctor_appointment_finance_bp.post("/appointments/<int:appointment_id>/payment")
@login_required(allowed_roles=["doctor"])
def update_appointment_payment(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

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
        discount_amount = Decimal(str(data.get("discount_amount", 0)))
        refund_amount = Decimal(str(data.get("refund_amount", 0)))
    except Exception:
        return jsonify({
            "status": "error",
            "message": "Fee, discount, and refund must be valid numbers."
        }), 400

    if discount_amount < 0 or refund_amount < 0 or fee_charged < 0:
        return jsonify({
            "status": "error",
            "message": "Amounts cannot be negative."
        }), 400

    new_status_expression = """
        case
            when %s = 'pending' and status = 'waiting' then 'pending_fee'
            when %s in ('paid', 'waived') and status = 'pending_fee' then 'waiting'
            else status
        end
    """

    try:
        with transaction() as cursor:
            cursor.execute(f"""
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
                    status = {new_status_expression},
                    updated_at = now()
                where appointment_id = %s
                  and doctor_id = %s
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
                appointment_id,
                doctor["doctor_id"]
            ))

            updated_payment = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.appointment_payment_log
                (
                    appointment_id,
                    doctor_id,
                    changed_by_user_id,
                    old_fee_status,
                    new_fee_status,
                    old_fee_charged,
                    new_fee_charged,
                    payment_method,
                    discount_amount,
                    refund_amount,
                    payment_note
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning
                    payment_log_id,
                    appointment_id,
                    doctor_id,
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
                doctor["doctor_id"],
                g.current_user["user_id"],
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
            "message": "Appointment payment updated.",
            "data": make_json_safe({
                "appointment": updated_payment,
                "payment_log": payment_log
            })
        })

    except Exception as error:
        print("UPDATE APPOINTMENT PAYMENT ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to update payment.",
            "error": str(error)
        }), 500


@doctor_appointment_finance_bp.get("/finance/summary")
@login_required(allowed_roles=["doctor"])
def get_doctor_finance_summary():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    try:
        where_clause, params, date_from, date_to = build_appointment_filters(
            doctor["doctor_id"],
            request.args
        )
    except ValueError as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 400

    base_from = """
        from public.appointment a
        join public.patient p
          on p.patient_id = a.patient_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.pa pa
          on pa.pa_id = a.pa_id
        left join public.app_user au
          on au.user_id = pa.user_id
    """

    summary = fetch_one(f"""
        select
            count(*) as total_appointments,

            count(*) filter (
                where a.status = 'completed'
            ) as completed_appointments,

            count(*) filter (
                where a.fee_status = 'paid'
            ) as paid_appointments,

            count(*) filter (
                where a.fee_status = 'pending'
            ) as pending_fee_appointments,

            count(*) filter (
                where a.fee_status = 'waived'
            ) as waived_appointments,

            coalesce(sum(a.fee_charged) filter (
                where a.status not in ('cancelled', 'no_show')
            ), 0) as gross_expected_amount,

            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as paid_amount,

            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'pending'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as pending_amount,

            coalesce(sum(a.fee_charged) filter (
                where a.fee_status = 'waived'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as waived_amount,

            coalesce(sum(coalesce(a.discount_amount, 0)), 0) as discount_amount,

            coalesce(sum(coalesce(a.refund_amount, 0)), 0) as refund_amount,

            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0) - coalesce(a.refund_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as net_collected_amount
        {base_from}
        where {where_clause}
    """, params)

    by_hospital = fetch_all(f"""
        select
            dh.id as doctor_hospital_id,
            dh.name as hospital_name,
            dh.city as hospital_city,
            count(*) as appointment_count,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as paid_amount,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'pending'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as pending_amount
        {base_from}
        where {where_clause}
        group by dh.id, dh.name, dh.city
        order by paid_amount desc
    """, params)

    by_pa = fetch_all(f"""
        select
            pa.pa_id,
            coalesce(pa.full_name, au.email, 'No PA') as pa_name,
            count(*) as appointment_count,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as paid_amount,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'pending'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as pending_amount
        {base_from}
        where {where_clause}
        group by pa.pa_id, pa.full_name, au.email
        order by paid_amount desc
    """, params)

    by_source = fetch_all(f"""
        select
            a.source,
            count(*) as appointment_count,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as paid_amount,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'pending'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as pending_amount
        {base_from}
        where {where_clause}
        group by a.source
        order by paid_amount desc
    """, params)

    by_day = fetch_all(f"""
        select
            date(a.appointment_datetime) as appointment_date,
            count(*) as appointment_count,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'paid'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as paid_amount,
            coalesce(sum(a.fee_charged - coalesce(a.discount_amount, 0)) filter (
                where a.fee_status = 'pending'
                  and a.status not in ('cancelled', 'no_show')
            ), 0) as pending_amount
        {base_from}
        where {where_clause}
        group by date(a.appointment_datetime)
        order by appointment_date desc
    """, params)

    pending_appointments = fetch_all(f"""
        select
            a.appointment_id,
            a.appointment_datetime,
            a.fee_charged,
            a.fee_status,
            a.status,
            a.source,
            p.name as patient_name,
            p.cnic as patient_cnic,
            dh.name as hospital_name,
            dh.city as hospital_city,
            coalesce(pa.full_name, au.email, 'No PA') as pa_name
        {base_from}
        where {where_clause}
          and a.fee_status = 'pending'
          and a.status not in ('cancelled', 'no_show')
        order by a.appointment_datetime desc
        limit 50
    """, params)

    return jsonify({
        "status": "ok",
        "message": "Doctor finance summary fetched.",
        "data": make_json_safe({
            "date_from": date_from,
            "date_to": date_to,
            "summary": summary,
            "by_hospital": by_hospital,
            "by_pa": by_pa,
            "by_source": by_source,
            "by_day": by_day,
            "pending_appointments": pending_appointments
        })
    })