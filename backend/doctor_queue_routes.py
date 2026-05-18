from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
import json

from flask import Blueprint, request, jsonify, g

from auth import login_required
from db import fetch_one, fetch_all, execute_query, transaction


doctor_queue_bp = Blueprint(
    "doctor_queue",
    __name__,
    url_prefix="/api/doctor"
)


LOCAL_TZ = ZoneInfo("Asia/Karachi")


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


def parse_local_date(value):
    if value:
        return date.fromisoformat(value)

    return datetime.now(LOCAL_TZ).date()


def get_day_range(target_date):
    start_dt = datetime.combine(target_date, time(0, 0), tzinfo=LOCAL_TZ)
    end_dt = start_dt + timedelta(days=1)

    return start_dt, end_dt


def get_current_doctor():
    return fetch_one(
        """
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
        """,
        (g.current_user["user_id"],)
    )


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


def get_appointment_for_doctor(doctor_id, appointment_id):
    return fetch_one(
        """
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
            a.status,
            a.source,
            a.priority_level,
            a.priority_reason,
            a.actual_start,
            a.actual_end,
            a.notes,

            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.dob as patient_dob,
            p.phone as patient_phone,
            p.email as patient_email,

            dh.name as hospital_name,
            dh.city as hospital_city,

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
        """,
        (
            appointment_id,
            doctor_id
        )
    )


def get_or_create_visit(cursor, appointment):
    cursor.execute(
        """
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
        """,
        (appointment["appointment_id"],)
    )

    visit = cursor.fetchone()

    if visit:
        return dict(visit)

    cursor.execute(
        """
        insert into public.visit
        (
            appointment_id,
            patient_id,
            doctor_id,
            started_at
        )
        values (%s, %s, %s, now())
        returning
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
        """,
        (
            appointment["appointment_id"],
            appointment["patient_id"],
            appointment["doctor_id"]
        )
    )

    return dict(cursor.fetchone())


@doctor_queue_bp.get("/queue/filters")
@login_required(allowed_roles=["doctor"])
def get_queue_filters():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    hospitals = fetch_all(
        """
        select
            id,
            name,
            city,
            address
        from public.doctor_hospital
        where doctor_id = %s
          and is_active = true
        order by name
        """,
        (doctor["doctor_id"],)
    )

    pas = fetch_all(
        """
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
        """,
        (doctor["doctor_id"],)
    )

    return jsonify({
        "status": "ok",
        "message": "Queue filters fetched.",
        "data": make_json_safe({
            "hospitals": hospitals,
            "pas": pas
        })
    })


@doctor_queue_bp.get("/queue")
@login_required(allowed_roles=["doctor"])
def get_doctor_queue():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    try:
        target_date = parse_local_date(request.args.get("date"))
    except ValueError:
        return jsonify({
            "status": "error",
            "message": "Date must be valid."
        }), 400

    start_dt, end_dt = get_day_range(target_date)

    hospital_id = request.args.get("doctor_hospital_id")
    pa_id = request.args.get("pa_id")
    status = request.args.get("status", "active")

    where_parts = [
        "a.doctor_id = %s",
        "a.appointment_datetime >= %s",
        "a.appointment_datetime < %s"
    ]

    params = [
        doctor["doctor_id"],
        start_dt,
        end_dt
    ]

    if hospital_id:
        where_parts.append("a.doctor_hospital_id = %s")
        params.append(int(hospital_id))

    if pa_id:
        where_parts.append("a.pa_id = %s")
        params.append(int(pa_id))

    if status and status != "all":
        if status == "active":
            where_parts.append("a.status in ('pending_fee', 'waiting', 'in_consultation')")
            where_parts.append("coalesce(a.status, '') not in ('cancelled', 'no_show', 'completed')")        
        else:
            where_parts.append("a.status = %s")
            params.append(status)

    where_clause = " and ".join(where_parts)

    appointments = fetch_all(
        f"""
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
            a.status,
            a.source,
            a.priority_level,
            a.priority_reason,
            a.actual_start,
            a.actual_end,
            a.notes,

            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.phone as patient_phone,

            dh.name as hospital_name,
            dh.city as hospital_city,

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
        where {where_clause}
        order by
            a.priority_level desc,
            a.appointment_datetime asc
        """,
        tuple(params)
    )

    return jsonify({
        "status": "ok",
        "message": "Doctor queue fetched.",
        "data": make_json_safe(appointments)
    })


@doctor_queue_bp.post("/appointments/<int:appointment_id>/mark-paid")
@login_required(allowed_roles=["doctor"])
def mark_appointment_paid(appointment_id):
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

    if appointment["status"] in ("completed", "cancelled", "no_show"):
        return jsonify({
            "status": "error",
            "message": "This appointment is already closed and cannot be marked paid."
        }), 400

    try:
        with transaction() as cursor:
            cursor.execute("""
                update public.appointment
                set
                    fee_status = 'paid',
                    status = case
                        when status = 'pending_fee' then 'waiting'
                        else status
                    end,
                    payment_method = coalesce(payment_method, 'cash'),
                    payment_received_at = coalesce(payment_received_at, now()),
                    payment_received_by_user_id = coalesce(payment_received_by_user_id, %s),
                    updated_at = now()
                where appointment_id = %s
                  and doctor_id = %s
                returning
                    appointment_id,
                    fee_status,
                    status,
                    fee_charged,
                    payment_method,
                    payment_received_at,
                    updated_at
            """, (
                g.current_user["user_id"],
                appointment_id,
                doctor["doctor_id"]
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
                    payment_note
                )
                values
                (
                    %s,
                    %s,
                    %s,
                    'doctor',
                    %s,
                    'paid',
                    %s,
                    %s,
                    'cash',
                    'Marked paid from doctor queue'
                )
            """, (
                appointment_id,
                doctor["doctor_id"],
                g.current_user["user_id"],
                appointment["fee_status"],
                appointment["fee_charged"],
                appointment["fee_charged"]
            ))

        return jsonify({
            "status": "ok",
            "message": "Fee marked as paid.",
            "data": make_json_safe(updated_appointment)
        })

    except Exception as error:
        print("MARK PAID ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to mark fee as paid.",
            "error": str(error)
        }), 500


@doctor_queue_bp.post("/appointments/<int:appointment_id>/queue-mark-paid")
@login_required(allowed_roles=["doctor"])
def queue_mark_appointment_paid(appointment_id):
    return mark_appointment_paid(appointment_id)


@doctor_queue_bp.post("/appointments/<int:appointment_id>/prioritize")
@login_required(allowed_roles=["doctor"])
def prioritize_appointment(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    try:
        priority_level = int(data.get("priority_level", 5))
    except (TypeError, ValueError):
        priority_level = 5

    if priority_level < 0:
        priority_level = 0

    if priority_level > 10:
        priority_level = 10

    priority_reason = clean_text(data.get("priority_reason"))

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

    rows = fetch_all(
        """
        update public.appointment
        set
            priority_level = %s,
            priority_reason = %s,
            updated_at = now()
        where appointment_id = %s
          and doctor_id = %s
        returning
            appointment_id,
            priority_level,
            priority_reason,
            updated_at
        """,
        (
            priority_level,
            priority_reason,
            appointment_id,
            doctor["doctor_id"]
        )
    )

    return jsonify({
        "status": "ok",
        "message": "Appointment priority updated.",
        "data": make_json_safe(rows[0] if rows else None)
    })


@doctor_queue_bp.post("/appointments/<int:appointment_id>/start")
@login_required(allowed_roles=["doctor"])
def start_consultation(appointment_id):
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

    if appointment["status"] == "completed":
        return jsonify({
            "status": "error",
            "message": "This appointment is already completed."
        }), 409

    if appointment["status"] == "cancelled":
        return jsonify({
            "status": "error",
            "message": "This appointment is cancelled and cannot be started."
        }), 409

    if appointment["status"] == "no_show":
        return jsonify({
            "status": "error",
            "message": "This appointment is marked as no-show and cannot be started."
        }), 409

    if appointment["status"] == "pending_fee":
        return jsonify({
            "status": "error",
            "message": "Fee is pending. Mark fee as paid before starting consultation."
        }), 409

    if appointment["fee_status"] not in ("paid", "waived"):
        return jsonify({
            "status": "error",
            "message": "Fee must be paid or waived before starting consultation."
        }), 409

    if appointment["status"] not in ("waiting", "in_consultation"):
        return jsonify({
            "status": "error",
            "message": "Only waiting appointments can be started."
        }), 409

    try:
        with transaction() as cursor:
            cursor.execute(
                """
                update public.appointment
                set
                    status = 'in_consultation',
                    actual_start = coalesce(actual_start, now()),
                    updated_at = now()
                where appointment_id = %s
                  and doctor_id = %s
                returning
                    appointment_id,
                    status,
                    actual_start
                """,
                (
                    appointment_id,
                    doctor["doctor_id"]
                )
            )

            updated_appointment = dict(cursor.fetchone())
            visit = get_or_create_visit(cursor, appointment)

        return jsonify({
            "status": "ok",
            "message": "Consultation started.",
            "data": make_json_safe({
                "appointment": updated_appointment,
                "visit": visit
            })
        })

    except Exception as error:
        print("START CONSULTATION ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to start consultation.",
            "error": str(error)
        }), 500


@doctor_queue_bp.get("/appointments/<int:appointment_id>/consultation")
@login_required(allowed_roles=["doctor"])
def get_consultation_details(appointment_id):
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

    visit = fetch_one(
        """
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
        """,
        (appointment_id,)
    )

    diagnosis = None

    if visit:
        diagnosis = fetch_one(
            """
            select
                diagnosis_id,
                visit_id,
                appointment_id,
                doctor_id,
                patient_id,
                diagnosis_text,
                treatment_plan,
                follow_up_notes,
                created_at
            from public.diagnosis
            where visit_id = %s
            limit 1
            """,
            (visit["visit_id"],)
        )

    dynamic_fields = fetch_all(
        """
        select
            field_id,
            field_label,
            field_key,
            field_type,
            is_required,
            options,
            placeholder,
            help_text,
            display_order
        from public.doctor_form_field
        where doctor_id = %s
          and field_context = 'consultation'
          and is_active = true
        order by display_order, created_at
        """,
        (doctor["doctor_id"],)
    )

    previous_history = fetch_all(
        """
        select
            a.appointment_id,
            a.appointment_datetime,
            a.status,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dg.diagnosis_text,
            dg.treatment_plan,
            dg.follow_up_notes
        from public.appointment a
        join public.doctor d
          on d.doctor_id = a.doctor_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.visit v
          on v.appointment_id = a.appointment_id
        left join public.diagnosis dg
          on dg.visit_id = v.visit_id
        where a.patient_id = %s
          and a.appointment_id <> %s
          and a.status = 'completed'
        order by a.appointment_datetime desc
        limit 10
        """,
        (
            appointment["patient_id"],
            appointment_id
        )
    )

    return jsonify({
        "status": "ok",
        "message": "Consultation details fetched.",
        "data": make_json_safe({
            "appointment": appointment,
            "visit": visit,
            "diagnosis": diagnosis,
            "dynamic_fields": dynamic_fields,
            "previous_history": previous_history
        })
    })


@doctor_queue_bp.post("/appointments/<int:appointment_id>/complete")
@login_required(allowed_roles=["doctor"])
def complete_consultation(appointment_id):
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

    if appointment["status"] == "completed":
        return jsonify({
            "status": "error",
            "message": "This appointment is already completed."
        }), 409

    if appointment["status"] not in ("in_consultation", "waiting"):
        return jsonify({
            "status": "error",
            "message": "Start the consultation before completing it."
        }), 409

    data = request.get_json(silent=True) or {}

    vitals = data.get("vitals") or {}
    clinical_notes = clean_text(data.get("clinical_notes"))
    diagnosis_text = clean_text(data.get("diagnosis_text"))
    treatment_plan = clean_text(data.get("treatment_plan"))
    follow_up_notes = clean_text(data.get("follow_up_notes"))
    dynamic_values = data.get("dynamic_values") or {}

    if not diagnosis_text:
        return jsonify({
            "status": "error",
            "message": "Diagnosis is required before completing consultation."
        }), 400

    allowed_fields = fetch_all(
        """
        select field_id
        from public.doctor_form_field
        where doctor_id = %s
          and field_context = 'consultation'
          and is_active = true
        """,
        (doctor["doctor_id"],)
    )

    allowed_field_ids = set(str(field["field_id"]) for field in allowed_fields)

    try:
        with transaction() as cursor:
            visit = get_or_create_visit(cursor, appointment)

            cursor.execute(
                """
                update public.visit
                set
                    completed_at = now(),
                    clinical_notes = %s,
                    bp = %s,
                    pulse = %s,
                    temperature = %s,
                    weight = %s,
                    updated_at = now()
                where visit_id = %s
                returning
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
                """,
                (
                    clinical_notes,
                    clean_text(vitals.get("bp")),
                    clean_text(vitals.get("pulse")),
                    clean_text(vitals.get("temperature")),
                    clean_text(vitals.get("weight")),
                    visit["visit_id"]
                )
            )

            updated_visit = dict(cursor.fetchone())

            cursor.execute(
                """
                delete from public.diagnosis
                where visit_id = %s
                """,
                (visit["visit_id"],)
            )

            cursor.execute(
                """
                insert into public.diagnosis
                (
                    visit_id,
                    appointment_id,
                    doctor_id,
                    patient_id,
                    diagnosis_text,
                    treatment_plan,
                    follow_up_notes
                )
                values (%s, %s, %s, %s, %s, %s, %s)
                returning
                    diagnosis_id,
                    visit_id,
                    appointment_id,
                    doctor_id,
                    patient_id,
                    diagnosis_text,
                    treatment_plan,
                    follow_up_notes,
                    created_at
                """,
                (
                    visit["visit_id"],
                    appointment["appointment_id"],
                    appointment["doctor_id"],
                    appointment["patient_id"],
                    diagnosis_text,
                    treatment_plan,
                    follow_up_notes
                )
            )

            diagnosis = dict(cursor.fetchone())

            cursor.execute(
                """
                delete from public.visit_field_value
                where visit_id = %s
                """,
                (visit["visit_id"],)
            )

            inserted_field_values = []

            for field_id, value in dynamic_values.items():
                if str(field_id) not in allowed_field_ids:
                    continue

                if isinstance(value, (dict, list)):
                    value_text = json.dumps(value)
                else:
                    value_text = str(value).strip()

                if value_text == "":
                    continue

                cursor.execute(
                    """
                    insert into public.visit_field_value
                    (
                        visit_id,
                        field_id,
                        value_text
                    )
                    values (%s, %s, %s)
                    returning
                        field_value_id,
                        visit_id,
                        field_id,
                        value_text,
                        created_at
                    """,
                    (
                        visit["visit_id"],
                        int(field_id),
                        value_text
                    )
                )

                inserted_field_values.append(dict(cursor.fetchone()))

            cursor.execute(
                """
                update public.appointment
                set
                    status = 'completed',
                    actual_end = now(),
                    updated_at = now()
                where appointment_id = %s
                  and doctor_id = %s
                returning
                    appointment_id,
                    status,
                    actual_start,
                    actual_end,
                    updated_at
                """,
                (
                    appointment_id,
                    doctor["doctor_id"]
                )
            )

            updated_appointment = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Consultation completed successfully.",
            "data": make_json_safe({
                "appointment": updated_appointment,
                "visit": updated_visit,
                "diagnosis": diagnosis,
                "dynamic_values": inserted_field_values
            })
        })

    except Exception as error:
        print("COMPLETE CONSULTATION ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to complete consultation.",
            "error": str(error)
        }), 500


@doctor_queue_bp.post("/appointments/<int:appointment_id>/dequeue")
@login_required(allowed_roles=["doctor"])
def dequeue_appointment_from_queue(appointment_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}
    reason = clean_text(data.get("reason")) or "Removed from queue by doctor"

    appointment = get_appointment_for_doctor(
        doctor["doctor_id"],
        appointment_id
    )

    if not appointment:
        return jsonify({
            "status": "error",
            "message": "Appointment not found for this doctor."
        }), 404

    if appointment["status"] in ("completed", "cancelled", "no_show"):
        return jsonify({
            "status": "error",
            "message": "This appointment is already closed."
        }), 400

    if appointment["status"] == "in_consultation":
        return jsonify({
            "status": "error",
            "message": "Consultation already started. Complete the consultation instead of removing it from queue."
        }), 400

    try:
        with transaction() as cursor:
            cursor.execute("""
                update public.appointment
                set
                    status = 'cancelled',
                    notes = concat_ws(
                        E'\n',
                        nullif(notes, ''),
                        concat('Dequeued by doctor. Reason: ', %s)
                    ),
                    updated_at = now()
                where appointment_id = %s
                  and doctor_id = %s
                  and status in ('pending_fee', 'waiting', 'scheduled')
                returning
                    appointment_id,
                    status,
                    notes,
                    updated_at
            """, (
                reason,
                appointment_id,
                doctor["doctor_id"]
            ))

            row = cursor.fetchone()

            if not row:
                return jsonify({
                    "status": "error",
                    "message": "Appointment could not be removed from queue."
                }), 400

            updated_appointment = dict(row)

        return jsonify({
            "status": "ok",
            "message": "Patient removed from queue.",
            "data": make_json_safe(updated_appointment)
        })

    except Exception as error:
        print("DEQUEUE APPOINTMENT ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to remove patient from queue.",
            "error": str(error)
        }), 500