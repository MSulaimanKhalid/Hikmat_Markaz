import os
import jwt
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import Blueprint, request, jsonify, g
from werkzeug.security import check_password_hash, generate_password_hash
from db import fetch_one, fetch_all, execute_query, transaction
from auth import login_required, hash_password


patient_portal_bp = Blueprint(
    "patient_portal",
    __name__,
    url_prefix="/api/patient"
)

pa_online_requests_bp = Blueprint(
    "pa_online_requests",
    __name__,
    url_prefix="/api/pa"
)


LOCAL_TZ = ZoneInfo("Asia/Karachi")


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

    return value


def create_patient_token(user):
    secret_key = os.getenv("APP_SECRET_KEY", "dev-secret-key")

    payload = {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.utcnow() + timedelta(hours=12)
    }

    return jwt.encode(payload, secret_key, algorithm="HS256")


def parse_date(value):
    if not value:
        return None

    return date.fromisoformat(value)


def parse_time_value(value):
    if isinstance(value, time):
        return value

    return time.fromisoformat(str(value)[0:8])


def parse_datetime_value(value):
    if not value:
        raise ValueError("Appointment datetime is required.")

    parsed = datetime.fromisoformat(str(value))

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=LOCAL_TZ)

    return parsed


def get_db_day_number(target_date):
    return (target_date.weekday() + 1) % 7


def get_current_patient():
    return fetch_one("""
        select
            p.patient_id,
            p.user_id,
            p.cnic,
            p.name,
            p.gender,
            p.dob,
            p.phone,
            p.email,
            p.is_active,
            au.email as login_email,
            au.status as account_status
        from public.patient p
        join public.app_user au
          on au.user_id = p.user_id
        where p.user_id = %s
        limit 1
    """, (g.current_user["user_id"],))


def require_active_patient():
    patient = get_current_patient()

    if not patient:
        return None, ({
            "status": "error",
            "message": "Patient profile not found."
        }, 404)

    if not patient["is_active"]:
        return None, ({
            "status": "error",
            "message": "Patient profile is inactive."
        }, 403)

    if patient["account_status"] != "active":
        return None, ({
            "status": "error",
            "message": "Patient account is not active."
        }, 403)

    return patient, None


def get_schedule_for_slot(doctor_hospital_id, slot_start, duration_minutes):
    target_date = slot_start.date()
    day_of_week = get_db_day_number(target_date)
    slot_time = slot_start.timetz().replace(tzinfo=None)
    slot_end = (slot_start + timedelta(minutes=duration_minutes)).timetz().replace(tzinfo=None)

    return fetch_one("""
        select
            s.schedule_id,
            s.doctor_hospital_id,
            s.day_of_week,
            s.start_time,
            s.end_time,
            s.default_consultation_minutes,
            s.consultation_fee,
            dh.doctor_id,
            dh.name as hospital_name,
            dh.city as hospital_city,
            d.name as doctor_name,
            d.specialization
        from public.doctor_hospital_schedule s
        join public.doctor_hospital dh
          on dh.id = s.doctor_hospital_id
        join public.doctor d
          on d.doctor_id = dh.doctor_id
        where s.doctor_hospital_id = %s
          and s.day_of_week = %s
          and s.is_active = true
          and dh.is_active = true
          and d.approval_status = 'approved'
          and %s::time >= s.start_time
          and %s::time <= s.end_time
        order by s.start_time
        limit 1
    """, (
        doctor_hospital_id,
        day_of_week,
        slot_time.isoformat(),
        slot_end.isoformat()
    ))


def has_appointment_overlap(doctor_hospital_id, slot_start, duration_minutes):
    slot_end = slot_start + timedelta(minutes=duration_minutes)

    existing_appointment = fetch_one("""
        select appointment_id
        from public.appointment
        where doctor_hospital_id = %s
          and appointment_datetime is not null
          and status not in ('cancelled', 'no_show')
          and (%s::timestamptz < (appointment_datetime + (duration_minutes || ' minutes')::interval)
               and %s::timestamptz > appointment_datetime)
        limit 1
    """, (
        doctor_hospital_id,
        slot_start.isoformat(),
        slot_end.isoformat()
    ))

    if existing_appointment:
        return True

    existing_request = fetch_one("""
        select request_id
        from public.appointment_request
        where doctor_hospital_id = %s
          and requested_datetime is not null
          and status in ('pending', 'confirmed')
          and (%s::timestamptz < (requested_datetime + (duration_minutes || ' minutes')::interval)
               and %s::timestamptz > requested_datetime)
        limit 1
    """, (
        doctor_hospital_id,
        slot_start.isoformat(),
        slot_end.isoformat()
    ))

    return existing_request is not None


def get_request_for_pa(pa_id, request_id):
    return fetch_one("""
        select
            ar.request_id,
            ar.patient_id,
            ar.doctor_id,
            ar.doctor_hospital_id,
            ar.requested_datetime,
            ar.duration_minutes,
            ar.expected_fee,
            ar.status,
            ar.patient_notes,
            ar.pa_notes,
            ar.confirmed_by_pa_id,
            ar.confirmed_appointment_id,
            ar.confirmed_at,
            ar.rejected_at,
            ar.rejection_reason,
            ar.created_at,

            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.phone as patient_phone,
            p.email as patient_email,

            d.name as doctor_name,
            d.specialization,

            dh.name as hospital_name,
            dh.city as hospital_city
        from public.appointment_request ar
        join public.patient p
          on p.patient_id = ar.patient_id
        join public.doctor d
          on d.doctor_id = ar.doctor_id
        join public.doctor_hospital dh
          on dh.id = ar.doctor_hospital_id
        join public.doctor_pa dp
          on dp.doctor_id = ar.doctor_id
         and dp.doctor_hospital_id = ar.doctor_hospital_id
         and dp.pa_id = %s
         and dp.is_active = true
        where ar.request_id = %s
        limit 1
    """, (
        pa_id,
        request_id
    ))


def get_current_pa():
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
        join public.app_user au
          on au.user_id = p.user_id
        where p.user_id = %s
        limit 1
    """, (g.current_user["user_id"],))


def require_active_pa():
    pa = get_current_pa()

    if not pa:
        return None, ({
            "status": "error",
            "message": "PA profile not found."
        }, 404)

    if not pa["is_active"]:
        return None, ({
            "status": "error",
            "message": "PA profile is inactive."
        }, 403)

    if pa["account_status"] != "active":
        return None, ({
            "status": "error",
            "message": "PA account is not active."
        }, 403)

    return pa, None


@patient_portal_bp.post("/signup")
def patient_signup():
    data = request.get_json(silent=True) or {}

    cnic = clean_text(data.get("cnic"))
    name = clean_text(data.get("name"))
    gender = clean_text(data.get("gender"))
    dob_raw = clean_text(data.get("dob"))
    phone = clean_text(data.get("phone"))
    email = clean_email(data.get("email"))
    password = data.get("password") or ""

    if not cnic:
        return jsonify({
            "status": "error",
            "message": "CNIC is required."
        }), 400

    if not name:
        return jsonify({
            "status": "error",
            "message": "Name is required."
        }), 400

    if gender and gender not in ["male", "female", "other"]:
        return jsonify({
            "status": "error",
            "message": "Gender must be male, female, or other."
        }), 400

    if len(password) < 8:
        return jsonify({
            "status": "error",
            "message": "Password must be at least 8 characters long."
        }), 400

    if not email:
        email = f"patient-{cnic}@hikmat.local"

    patient_dob = None

    if dob_raw:
        try:
            patient_dob = parse_date(dob_raw)
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "Date of birth must be valid."
            }), 400

    existing_user = fetch_one("""
        select user_id
        from public.app_user
        where lower(email) = %s
        limit 1
    """, (email,))

    if existing_user:
        return jsonify({
            "status": "error",
            "message": "An account with this email already exists."
        }), 409

    existing_patient = fetch_one("""
        select patient_id, user_id, cnic, name
        from public.patient
        where cnic = %s
        limit 1
    """, (cnic,))

    if existing_patient and existing_patient["user_id"]:
        return jsonify({
            "status": "error",
            "message": "A patient account already exists for this CNIC."
        }), 409

    password_hash = generate_password_hash(
        password,
        method="pbkdf2:sha256",
        salt_length=16
    )

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
                values (%s, %s, %s, 'patient', 'active')
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

            if existing_patient:
                cursor.execute("""
                    update public.patient
                    set
                        user_id = %s,
                        name = %s,
                        gender = %s,
                        dob = %s,
                        phone = %s,
                        email = %s,
                        is_active = true,
                        updated_at = now()
                    where patient_id = %s
                    returning
                        patient_id,
                        user_id,
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active,
                        updated_at
                """, (
                    app_user["user_id"],
                    name,
                    gender,
                    patient_dob,
                    phone,
                    email,
                    existing_patient["patient_id"]
                ))
            else:
                cursor.execute("""
                    insert into public.patient
                    (
                        user_id,
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, true)
                    returning
                        patient_id,
                        user_id,
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active,
                        created_at
                """, (
                    app_user["user_id"],
                    cnic,
                    name,
                    gender,
                    patient_dob,
                    phone,
                    email
                ))

            patient = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Patient account created successfully.",
            "data": make_json_safe({
                "user": app_user,
                "patient": patient
            })
        }), 201

    except Exception as error:
        print("PATIENT SIGNUP ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Patient signup failed.",
            "error": str(error)
        }), 500


@patient_portal_bp.post("/login")
def patient_login():
    try:
        data = request.get_json(silent=True) or {}

        cnic = clean_text(data.get("cnic"))
        cnic = "".join(ch for ch in cnic if ch.isdigit())

        password = data.get("password") or ""

        if not cnic:
            return jsonify({
                "status": "error",
                "message": "CNIC is required."
            }), 400

        if len(cnic) != 13:
            return jsonify({
                "status": "error",
                "message": "CNIC must be exactly 13 digits."
            }), 400

        if not password:
            return jsonify({
                "status": "error",
                "message": "Password is required."
            }), 400

        patient = fetch_one("""
            select
                p.patient_id,
                p.user_id,
                p.cnic,
                p.name,
                p.is_active,
                au.email,
                au.password_hash,
                au.role,
                au.status
            from public.patient p
            join public.app_user au
              on au.user_id = p.user_id
            where p.cnic = %s
              and au.role = 'patient'
            limit 1
        """, (cnic,))

        if not patient:
            return jsonify({
                "status": "error",
                "message": "Invalid CNIC or password."
            }), 401

        stored_hash = patient["password_hash"] or ""

        if not stored_hash or "$" not in stored_hash:
            return jsonify({
                "status": "error",
                "message": "This patient account has an invalid or old password record. Please reset/repair this patient password."
            }), 401

        try:
            password_ok = check_password_hash(stored_hash, password)
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "This patient account has an invalid password hash. Please reset/repair this patient password."
            }), 401

        if not password_ok:
            return jsonify({
                "status": "error",
                "message": "Invalid CNIC or password."
            }), 401

        if not patient["is_active"] or patient["status"] != "active":
            return jsonify({
                "status": "error",
                "message": "Patient account is not active."
            }), 403

        user_payload = {
            "user_id": patient["user_id"],
            "email": patient["email"],
            "role": "patient",
            "status": patient["status"]
        }

        token = create_patient_token(user_payload)

        return jsonify({
            "status": "ok",
            "message": "Patient login successful.",
            "token": token,
            "user": user_payload,
            "patient": make_json_safe({
                "patient_id": patient["patient_id"],
                "cnic": patient["cnic"],
                "name": patient["name"]
            })
        })

    except Exception as error:
        print("PATIENT LOGIN ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Patient login failed due to backend error.",
            "error": str(error)
        }), 500


@patient_portal_bp.get("/me")
@login_required(allowed_roles=["patient"])
def patient_me():
    patient, error = require_active_patient()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    return jsonify({
        "status": "ok",
        "message": "Patient profile fetched.",
        "data": make_json_safe(patient)
    })


@patient_portal_bp.get("/appointments")
@login_required(allowed_roles=["patient"])
def patient_appointments():
    patient, error = require_active_patient()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    appointments = fetch_all("""
        select
            a.appointment_id,
            a.appointment_datetime,
            a.duration_minutes,
            a.fee_charged,
            a.fee_status,
            a.status,
            a.source,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.appointment a
        join public.doctor d
          on d.doctor_id = a.doctor_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        where a.patient_id = %s
        order by a.appointment_datetime desc
    """, (patient["patient_id"],))

    requests = fetch_all("""
        select
            ar.request_id,
            ar.requested_datetime,
            ar.duration_minutes,
            ar.expected_fee,
            ar.status,
            ar.patient_notes,
            ar.pa_notes,
            ar.confirmed_appointment_id,
            ar.rejection_reason,
            ar.created_at,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.appointment_request ar
        join public.doctor d
          on d.doctor_id = ar.doctor_id
        join public.doctor_hospital dh
          on dh.id = ar.doctor_hospital_id
        where ar.patient_id = %s
        order by ar.created_at desc
    """, (patient["patient_id"],))

    return jsonify({
        "status": "ok",
        "message": "Patient appointments fetched.",
        "data": make_json_safe({
            "appointments": appointments,
            "requests": requests
        })
    })


@patient_portal_bp.get("/prescriptions")
@login_required(allowed_roles=["patient"])
def patient_prescriptions():
    patient, error = require_active_patient()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    visits = fetch_all("""
        select
            v.visit_id,
            v.appointment_id,
            v.completed_at,
            v.bp,
            v.pulse,
            v.temperature,
            v.weight,
            a.appointment_datetime,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.city as hospital_city,
            dg.diagnosis_text,
            dg.treatment_plan,
            dg.follow_up_notes
        from public.visit v
        join public.appointment a
          on a.appointment_id = v.appointment_id
        join public.doctor d
          on d.doctor_id = v.doctor_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.diagnosis dg
          on dg.visit_id = v.visit_id
        where v.patient_id = %s
          and a.status = 'completed'
        order by a.appointment_datetime desc
    """, (patient["patient_id"],))

    return jsonify({
        "status": "ok",
        "message": "Patient prescriptions fetched.",
        "data": make_json_safe(visits)
    })


@patient_portal_bp.get("/prescriptions/visits/<int:visit_id>/print")
@login_required(allowed_roles=["patient"])
def patient_prescription_print_format(visit_id):
    patient, error = require_active_patient()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    prescription = fetch_one("""
        select
            v.visit_id,
            v.appointment_id,
            v.patient_id,
            v.doctor_id,
            v.started_at,
            v.completed_at,
            v.bp,
            v.pulse,
            v.temperature,
            v.weight,
            v.clinical_notes,

            p.name as patient_name,
            p.cnic as patient_cnic,
            p.gender as patient_gender,
            p.dob as patient_dob,
            p.phone as patient_phone,
            p.email as patient_email,

            d.name as doctor_name,
            d.specialization as doctor_specialization,
            d.license_number as doctor_license_number,

            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city,

            a.appointment_datetime,
            a.scheduled_start,
            a.fee_charged,
            a.fee_status,
            a.status as appointment_status,

            dg.diagnosis_text,
            dg.treatment_plan,
            dg.follow_up_notes
        from public.visit v
        join public.patient p
          on p.patient_id = v.patient_id
        join public.doctor d
          on d.doctor_id = v.doctor_id
        join public.appointment a
          on a.appointment_id = v.appointment_id
        left join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.diagnosis dg
          on dg.visit_id = v.visit_id
        where v.visit_id = %s
          and v.patient_id = %s
          and a.status = 'completed'
        limit 1
    """, (
        visit_id,
        patient["patient_id"]
    ))

    if not prescription:
        return jsonify({
            "status": "error",
            "message": "Prescription not found for this patient."
        }), 404

    dynamic_fields = fetch_all("""
        select
            field_label_snapshot,
            field_type_snapshot,
            field_context_snapshot,
            value_text
        from public.visit_field_value
        where visit_id = %s
        order by field_value_id
    """, (visit_id,))

    return jsonify({
        "status": "ok",
        "message": "Prescription print format fetched.",
        "data": make_json_safe({
            "prescription": prescription,
            "dynamic_fields": dynamic_fields
        })
    })


@patient_portal_bp.get("/doctors")
@login_required(allowed_roles=["patient"])
def patient_available_doctors():
    doctors = fetch_all("""
        select
            dh.id as doctor_hospital_id,
            dh.doctor_id,
            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city,
            d.name as doctor_name,
            d.specialization,
            d.license_number,
            count(s.schedule_id) as active_schedule_count,
            min(s.consultation_fee) as minimum_fee
        from public.doctor_hospital dh
        join public.doctor d
          on d.doctor_id = dh.doctor_id
        left join public.doctor_hospital_schedule s
          on s.doctor_hospital_id = dh.id
         and s.is_active = true
        where dh.is_active = true
          and d.approval_status = 'approved'
        group by
            dh.id,
            dh.doctor_id,
            dh.name,
            dh.address,
            dh.city,
            d.name,
            d.specialization,
            d.license_number
        having count(s.schedule_id) > 0
        order by d.name, dh.name
    """)

    return jsonify({
        "status": "ok",
        "message": "Available doctors fetched.",
        "data": make_json_safe(doctors)
    })


@patient_portal_bp.get("/available-slots")
@login_required(allowed_roles=["patient"])
def patient_available_slots():
    doctor_hospital_id = request.args.get("doctor_hospital_id")
    days = request.args.get("days", 14)

    try:
        doctor_hospital_id = int(doctor_hospital_id)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Valid doctor hospital is required."
        }), 400

    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14

    if days < 1:
        days = 1

    if days > 30:
        days = 30

    schedules = fetch_all("""
        select
            s.schedule_id,
            s.doctor_hospital_id,
            s.day_of_week,
            s.start_time,
            s.end_time,
            s.default_consultation_minutes,
            s.consultation_fee,
            dh.doctor_id,
            dh.name as hospital_name,
            dh.city as hospital_city,
            d.name as doctor_name,
            d.specialization
        from public.doctor_hospital_schedule s
        join public.doctor_hospital dh
          on dh.id = s.doctor_hospital_id
        join public.doctor d
          on d.doctor_id = dh.doctor_id
        where s.doctor_hospital_id = %s
          and s.is_active = true
          and dh.is_active = true
          and d.approval_status = 'approved'
        order by s.day_of_week, s.start_time
    """, (doctor_hospital_id,))

    today = datetime.now(LOCAL_TZ).date()
    now_dt = datetime.now(LOCAL_TZ)

    slots = []

    for offset in range(days):
        target_date = today + timedelta(days=offset)
        day_number = get_db_day_number(target_date)

        for schedule in schedules:
            if int(schedule["day_of_week"]) != day_number:
                continue

            start_time = parse_time_value(schedule["start_time"])
            end_time = parse_time_value(schedule["end_time"])
            duration = int(schedule["default_consultation_minutes"] or 15)

            current_start = datetime.combine(target_date, start_time, tzinfo=LOCAL_TZ)
            schedule_end = datetime.combine(target_date, end_time, tzinfo=LOCAL_TZ)

            while current_start + timedelta(minutes=duration) <= schedule_end:
                current_end = current_start + timedelta(minutes=duration)

                if current_start > now_dt:
                    if not has_appointment_overlap(doctor_hospital_id, current_start, duration):
                        slots.append({
                            "doctor_hospital_id": doctor_hospital_id,
                            "doctor_id": schedule["doctor_id"],
                            "doctor_name": schedule["doctor_name"],
                            "specialization": schedule["specialization"],
                            "hospital_name": schedule["hospital_name"],
                            "hospital_city": schedule["hospital_city"],
                            "date": target_date.isoformat(),
                            "start_time": current_start.time().isoformat(timespec="minutes"),
                            "end_time": current_end.time().isoformat(timespec="minutes"),
                            "appointment_datetime": current_start.isoformat(),
                            "duration_minutes": duration,
                            "expected_fee": make_json_safe(schedule["consultation_fee"])
                        })

                current_start = current_end

    return jsonify({
        "status": "ok",
        "message": "Available patient slots fetched.",
        "data": make_json_safe(slots)
    })


@patient_portal_bp.post("/appointment-requests")
@login_required(allowed_roles=["patient"])
def create_patient_appointment_request():
    patient, error = require_active_patient()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    doctor_hospital_id = data.get("doctor_hospital_id")
    appointment_datetime = data.get("appointment_datetime")
    patient_notes = clean_text(data.get("patient_notes"))

    try:
        doctor_hospital_id = int(doctor_hospital_id)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Valid doctor hospital is required."
        }), 400

    try:
        slot_start = parse_datetime_value(appointment_datetime)
    except ValueError as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 400

    schedule = get_schedule_for_slot(doctor_hospital_id, slot_start, 1)

    if not schedule:
        return jsonify({
            "status": "error",
            "message": "Selected time is not inside doctor's active schedule."
        }), 400

    duration_minutes = int(schedule["default_consultation_minutes"] or 15)
    expected_fee = schedule["consultation_fee"] or 0

    full_schedule = get_schedule_for_slot(doctor_hospital_id, slot_start, duration_minutes)

    if not full_schedule:
        return jsonify({
            "status": "error",
            "message": "Selected appointment duration does not fit inside doctor's schedule."
        }), 400

    if has_appointment_overlap(doctor_hospital_id, slot_start, duration_minutes):
        return jsonify({
            "status": "error",
            "message": "This slot is no longer available. Please refresh slots."
        }), 409

    rows = execute_query("""
        insert into public.appointment_request
        (
            patient_id,
            doctor_id,
            doctor_hospital_id,
            requested_datetime,
            duration_minutes,
            expected_fee,
            status,
            patient_notes
        )
        values (%s, %s, %s, %s, %s, %s, 'pending', %s)
        returning
            request_id,
            patient_id,
            doctor_id,
            doctor_hospital_id,
            requested_datetime,
            duration_minutes,
            expected_fee,
            status,
            patient_notes,
            created_at
    """, (
        patient["patient_id"],
        schedule["doctor_id"],
        doctor_hospital_id,
        slot_start,
        duration_minutes,
        expected_fee,
        patient_notes
    ))

    return jsonify({
        "status": "ok",
        "message": "Appointment request submitted. PA will confirm it.",
        "data": make_json_safe(rows[0] if rows else None)
    }), 201


@pa_online_requests_bp.get("/appointment-requests")
@login_required(allowed_roles=["pa"])
def get_pa_online_requests():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    status = request.args.get("status", "pending")

    where_parts = [
        "dp.pa_id = %s",
        "dp.is_active = true"
    ]

    params = [pa["pa_id"]]

    if status and status != "all":
        where_parts.append("ar.status = %s")
        params.append(status)

    where_clause = " and ".join(where_parts)

    requests = fetch_all(f"""
        select
            ar.request_id,
            ar.patient_id,
            ar.doctor_id,
            ar.doctor_hospital_id,
            ar.requested_datetime,
            ar.duration_minutes,
            ar.expected_fee,
            ar.status,
            ar.patient_notes,
            ar.pa_notes,
            ar.confirmed_appointment_id,
            ar.rejection_reason,
            ar.created_at,

            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.phone as patient_phone,
            p.email as patient_email,

            d.name as doctor_name,
            d.specialization,

            dh.name as hospital_name,
            dh.city as hospital_city
        from public.appointment_request ar
        join public.patient p
          on p.patient_id = ar.patient_id
        join public.doctor d
          on d.doctor_id = ar.doctor_id
        join public.doctor_hospital dh
          on dh.id = ar.doctor_hospital_id
        join public.doctor_pa dp
          on dp.doctor_id = ar.doctor_id
         and dp.doctor_hospital_id = ar.doctor_hospital_id
        where {where_clause}
        order by ar.requested_datetime asc
    """, tuple(params))

    return jsonify({
        "status": "ok",
        "message": "PA online appointment requests fetched.",
        "data": make_json_safe(requests)
    })


@pa_online_requests_bp.post("/appointment-requests/<int:request_id>/confirm")
@login_required(allowed_roles=["pa"])
def confirm_pa_online_request(request_id):
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}
    pa_notes = clean_text(data.get("pa_notes"))
    fee_status = clean_text(data.get("fee_status")) or "pending"

    if fee_status not in ["pending", "paid", "waived"]:
        return jsonify({
            "status": "error",
            "message": "Fee status must be pending, paid, or waived."
        }), 400

    request_row = get_request_for_pa(pa["pa_id"], request_id)

    if not request_row:
        return jsonify({
            "status": "error",
            "message": "Appointment request not found for this PA."
        }), 404

    if request_row["status"] != "pending":
        return jsonify({
            "status": "error",
            "message": f"This request is already {request_row['status']}."
        }), 409

    requested_dt = request_row["requested_datetime"]

    if has_appointment_overlap(
        request_row["doctor_hospital_id"],
        requested_dt,
        int(request_row["duration_minutes"] or 15)
    ):
        same_request = fetch_one("""
            select request_id
            from public.appointment_request
            where request_id = %s
              and status = 'pending'
            limit 1
        """, (request_id,))

        if not same_request:
            return jsonify({
                "status": "error",
                "message": "This slot is no longer available."
            }), 409

    appointment_status = "waiting" if fee_status in ["paid", "waived"] else "pending_fee"

    try:
        with transaction() as cursor:
            cursor.execute("""
                insert into public.appointment
                (
                    patient_id,
                    doctor_id,
                    doctor_hospital_id,
                    pa_id,
                    appointment_datetime,
                    duration_minutes,
                    fee_charged,
                    fee_status,
                    status,
                    source,
                    priority_level,
                    notes
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'online_request', 0, %s)
                returning
                    appointment_id,
                    patient_id,
                    doctor_id,
                    doctor_hospital_id,
                    pa_id,
                    appointment_datetime,
                    duration_minutes,
                    fee_charged,
                    fee_status,
                    status,
                    source,
                    created_at
            """, (
                request_row["patient_id"],
                request_row["doctor_id"],
                request_row["doctor_hospital_id"],
                pa["pa_id"],
                request_row["requested_datetime"],
                request_row["duration_minutes"],
                request_row["expected_fee"],
                fee_status,
                appointment_status,
                pa_notes
            ))

            appointment = dict(cursor.fetchone())

            cursor.execute("""
                update public.appointment_request
                set
                    status = 'confirmed',
                    confirmed_by_pa_id = %s,
                    confirmed_appointment_id = %s,
                    confirmed_at = now(),
                    pa_notes = %s,
                    updated_at = now()
                where request_id = %s
                returning
                    request_id,
                    status,
                    confirmed_by_pa_id,
                    confirmed_appointment_id,
                    confirmed_at,
                    pa_notes
            """, (
                pa["pa_id"],
                appointment["appointment_id"],
                pa_notes,
                request_id
            ))

            updated_request = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Appointment request confirmed and appointment created.",
            "data": make_json_safe({
                "request": updated_request,
                "appointment": appointment
            })
        }), 201

    except Exception as error:
        print("CONFIRM ONLINE REQUEST ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Failed to confirm appointment request.",
            "error": str(error)
        }), 500


@pa_online_requests_bp.post("/appointment-requests/<int:request_id>/reject")
@login_required(allowed_roles=["pa"])
def reject_pa_online_request(request_id):
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}
    rejection_reason = clean_text(data.get("rejection_reason"))

    if not rejection_reason:
        return jsonify({
            "status": "error",
            "message": "Rejection reason is required."
        }), 400

    request_row = get_request_for_pa(pa["pa_id"], request_id)

    if not request_row:
        return jsonify({
            "status": "error",
            "message": "Appointment request not found for this PA."
        }), 404

    if request_row["status"] != "pending":
        return jsonify({
            "status": "error",
            "message": f"This request is already {request_row['status']}."
        }), 409

    rows = execute_query("""
        update public.appointment_request
        set
            status = 'rejected',
            rejected_at = now(),
            rejection_reason = %s,
            updated_at = now()
        where request_id = %s
        returning
            request_id,
            status,
            rejection_reason,
            rejected_at
    """, (
        rejection_reason,
        request_id
    ))

    return jsonify({
        "status": "ok",
        "message": "Appointment request rejected.",
        "data": make_json_safe(rows[0] if rows else None)
    })