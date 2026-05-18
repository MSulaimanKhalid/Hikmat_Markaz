from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import Blueprint, request, jsonify, g

from db import fetch_one, fetch_all, transaction
from auth import login_required


pa_workspace_bp = Blueprint(
    "pa_workspace",
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


def get_assignment_for_pa(pa_id, assignment_id):
    return fetch_one("""
        select
            dp.doctor_pa_id,
            dp.doctor_id,
            dp.pa_id,
            dp.doctor_hospital_id,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city
        from public.doctor_pa dp
        join public.doctor d
          on d.doctor_id = dp.doctor_id
        join public.doctor_hospital dh
          on dh.id = dp.doctor_hospital_id
        where dp.doctor_pa_id = %s
          and dp.pa_id = %s
          and dp.is_active = true
          and dh.is_active = true
        limit 1
    """, (
        assignment_id,
        pa_id
    ))


def find_patient_by_cnic(cnic):
    return fetch_one("""
        select
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
        from public.patient
        where cnic = %s
        limit 1
    """, (cnic,))


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
            s.consultation_fee
        from public.doctor_hospital_schedule s
        where s.doctor_hospital_id = %s
          and s.day_of_week = %s
          and s.is_active = true
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

    existing = fetch_one("""
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

    return existing is not None


@pa_workspace_bp.get("/me")
@login_required(allowed_roles=["pa"])
def pa_me():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    return jsonify({
        "status": "ok",
        "message": "PA profile fetched.",
        "data": make_json_safe(pa)
    })


@pa_workspace_bp.get("/assignments")
@login_required(allowed_roles=["pa"])
def get_pa_assignments():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    assignments = fetch_all("""
        select
            dp.doctor_pa_id,
            dp.doctor_id,
            dp.pa_id,
            dp.doctor_hospital_id,
            dp.created_at,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city,
            count(s.schedule_id) as active_schedule_count
        from public.doctor_pa dp
        join public.doctor d
          on d.doctor_id = dp.doctor_id
        join public.doctor_hospital dh
          on dh.id = dp.doctor_hospital_id
        left join public.doctor_hospital_schedule s
          on s.doctor_hospital_id = dh.id
         and s.is_active = true
        where dp.pa_id = %s
          and dp.is_active = true
          and dh.is_active = true
        group by
            dp.doctor_pa_id,
            dp.doctor_id,
            dp.pa_id,
            dp.doctor_hospital_id,
            dp.created_at,
            d.name,
            d.specialization,
            dh.name,
            dh.address,
            dh.city
        order by dp.created_at desc
    """, (pa["pa_id"],))

    return jsonify({
        "status": "ok",
        "message": "PA assignments fetched.",
        "data": make_json_safe(assignments)
    })


@pa_workspace_bp.get("/patients/search")
@login_required(allowed_roles=["pa"])
def search_patient():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    cnic = clean_text(request.args.get("cnic"))

    if not cnic:
        return jsonify({
            "status": "error",
            "message": "CNIC is required."
        }), 400

    patient = find_patient_by_cnic(cnic)

    if not patient:
        return jsonify({
            "status": "ok",
            "message": "Patient not found.",
            "data": None
        })

    return jsonify({
        "status": "ok",
        "message": "Patient found.",
        "data": make_json_safe(patient)
    })


@pa_workspace_bp.get("/available-slots")
@login_required(allowed_roles=["pa"])
def get_available_slots():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    assignment_id = request.args.get("assignment_id")
    days = request.args.get("days", 14)

    try:
        assignment_id = int(assignment_id)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Valid assignment is required."
        }), 400

    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14

    if days < 1:
        days = 1

    if days > 30:
        days = 30

    assignment = get_assignment_for_pa(pa["pa_id"], assignment_id)

    if not assignment:
        return jsonify({
            "status": "error",
            "message": "Assignment not found for this PA."
        }), 404

    schedules = fetch_all("""
        select
            schedule_id,
            doctor_hospital_id,
            day_of_week,
            start_time,
            end_time,
            default_consultation_minutes,
            consultation_fee
        from public.doctor_hospital_schedule
        where doctor_hospital_id = %s
          and is_active = true
        order by day_of_week, start_time
    """, (assignment["doctor_hospital_id"],))

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
                    if not has_appointment_overlap(
                        assignment["doctor_hospital_id"],
                        current_start,
                        duration
                    ):
                        slots.append({
                            "assignment_id": assignment["doctor_pa_id"],
                            "doctor_id": assignment["doctor_id"],
                            "doctor_name": assignment["doctor_name"],
                            "doctor_hospital_id": assignment["doctor_hospital_id"],
                            "hospital_name": assignment["hospital_name"],
                            "hospital_city": assignment["hospital_city"],
                            "date": target_date.isoformat(),
                            "start_time": current_start.time().isoformat(timespec="minutes"),
                            "end_time": current_end.time().isoformat(timespec="minutes"),
                            "appointment_datetime": current_start.isoformat(),
                            "duration_minutes": duration,
                            "consultation_fee": make_json_safe(schedule["consultation_fee"])
                        })

                current_start = current_end

    return jsonify({
        "status": "ok",
        "message": "Available slots fetched.",
        "data": make_json_safe(slots)
    })


@pa_workspace_bp.post("/appointments")
@login_required(allowed_roles=["pa"])
def create_appointment():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    assignment_id = data.get("assignment_id")
    patient_data = data.get("patient") or {}
    appointment_datetime = data.get("appointment_datetime")
    fee_status = clean_text(data.get("fee_status")) or "pending"
    notes = clean_text(data.get("notes"))

    try:
        assignment_id = int(assignment_id)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Valid assignment is required."
        }), 400

    assignment = get_assignment_for_pa(pa["pa_id"], assignment_id)

    if not assignment:
        return jsonify({
            "status": "error",
            "message": "Assignment not found for this PA."
        }), 404

    patient_cnic = clean_text(patient_data.get("cnic"))
    patient_name = clean_text(patient_data.get("name"))
    patient_gender = clean_text(patient_data.get("gender"))
    patient_phone = clean_text(patient_data.get("phone"))
    patient_email = clean_email(patient_data.get("email"))
    patient_dob_raw = clean_text(patient_data.get("dob"))

    if not patient_cnic:
        return jsonify({
            "status": "error",
            "message": "Patient CNIC is required."
        }), 400

    if not patient_name:
        return jsonify({
            "status": "error",
            "message": "Patient name is required."
        }), 400

    if fee_status not in ["pending", "paid", "waived"]:
        return jsonify({
            "status": "error",
            "message": "Fee status must be pending, paid, or waived."
        }), 400

    try:
        slot_start = parse_datetime_value(appointment_datetime)
    except ValueError as error:
        return jsonify({
            "status": "error",
            "message": str(error)
        }), 400

    existing_schedule = get_schedule_for_slot(
        assignment["doctor_hospital_id"],
        slot_start,
        1
    )

    if not existing_schedule:
        return jsonify({
            "status": "error",
            "message": "Selected time is not inside doctor's active schedule."
        }), 400

    duration_minutes = int(existing_schedule["default_consultation_minutes"] or 15)
    consultation_fee = existing_schedule["consultation_fee"] or 0

    full_slot_schedule = get_schedule_for_slot(
        assignment["doctor_hospital_id"],
        slot_start,
        duration_minutes
    )

    if not full_slot_schedule:
        return jsonify({
            "status": "error",
            "message": "Selected appointment duration does not fit inside doctor's schedule."
        }), 400

    if has_appointment_overlap(
        assignment["doctor_hospital_id"],
        slot_start,
        duration_minutes
    ):
        return jsonify({
            "status": "error",
            "message": "This slot has already been booked. Refresh available slots."
        }), 409

    patient_dob = None

    if patient_dob_raw:
        try:
            patient_dob = parse_date(patient_dob_raw)
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "Patient date of birth must be valid."
            }), 400

    appointment_status = "waiting" if fee_status in ["paid", "waived"] else "pending_fee"

    try:
        with transaction() as cursor:
            cursor.execute("""
                select
                    patient_id,
                    cnic,
                    name,
                    gender,
                    dob,
                    phone,
                    email,
                    is_active
                from public.patient
                where cnic = %s
                limit 1
            """, (patient_cnic,))

            existing_patient = cursor.fetchone()

            if existing_patient:
                cursor.execute("""
                    update public.patient
                    set
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
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active,
                        updated_at
                """, (
                    patient_name,
                    patient_gender,
                    patient_dob,
                    patient_phone,
                    patient_email,
                    existing_patient["patient_id"]
                ))

                patient = dict(cursor.fetchone())
            else:
                cursor.execute("""
                    insert into public.patient
                    (
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active
                    )
                    values (%s, %s, %s, %s, %s, %s, true)
                    returning
                        patient_id,
                        cnic,
                        name,
                        gender,
                        dob,
                        phone,
                        email,
                        is_active,
                        created_at
                """, (
                    patient_cnic,
                    patient_name,
                    patient_gender,
                    patient_dob,
                    patient_phone,
                    patient_email
                ))

                patient = dict(cursor.fetchone())

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
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'walk_in', 0, %s)
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
                    priority_level,
                    notes,
                    created_at
            """, (
                patient["patient_id"],
                assignment["doctor_id"],
                assignment["doctor_hospital_id"],
                pa["pa_id"],
                slot_start,
                duration_minutes,
                consultation_fee,
                fee_status,
                appointment_status,
                notes
            ))

            appointment = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Appointment booked successfully.",
            "data": make_json_safe({
                "patient": patient,
                "appointment": appointment,
                "assignment": assignment
            })
        }), 201

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Appointment booking failed.",
            "error": str(error)
        }), 500


@pa_workspace_bp.get("/appointments")
@login_required(allowed_roles=["pa"])
def get_pa_appointments():
    pa, error = require_active_pa()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    target_date_raw = request.args.get("date")

    if target_date_raw:
        try:
            target_date = date.fromisoformat(target_date_raw)
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "Date must be valid."
            }), 400
    else:
        target_date = datetime.now(LOCAL_TZ).date()

    start_dt = datetime.combine(target_date, time(0, 0), tzinfo=LOCAL_TZ)
    end_dt = start_dt + timedelta(days=1)

    appointments = fetch_all("""
        select
            a.appointment_id,
            a.appointment_datetime,
            a.duration_minutes,
            a.fee_charged,
            a.fee_status,
            a.status,
            a.source,
            a.priority_level,
            a.notes,
            p.patient_id,
            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.phone as patient_phone,
            d.name as doctor_name,
            d.specialization,
            dh.name as hospital_name,
            dh.city as hospital_city
        from public.appointment a
        join public.patient p
          on p.patient_id = a.patient_id
        join public.doctor d
          on d.doctor_id = a.doctor_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        where a.pa_id = %s
          and a.appointment_datetime >= %s
          and a.appointment_datetime < %s
        order by a.appointment_datetime asc
    """, (
        pa["pa_id"],
        start_dt,
        end_dt
    ))

    return jsonify({
        "status": "ok",
        "message": "PA appointments fetched.",
        "data": make_json_safe(appointments)
    })