from datetime import date, datetime, time
from decimal import Decimal
import json
import re

from flask import Blueprint, request, jsonify, g

from db import fetch_one, fetch_all, execute_query
from auth import login_required


doctor_settings_bp = Blueprint(
    "doctor_settings",
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


def make_field_key(label):
    key = label.lower().strip()
    key = re.sub(r"[^a-z0-9]+", "_", key)
    key = re.sub(r"_+", "_", key)
    key = key.strip("_")
    return key


def first_row(rows):
    return rows[0] if rows else None


def get_current_doctor():
    doctor = fetch_one("""
        select
            doctor_id,
            user_id,
            name,
            specialization,
            license_number,
            approval_status,
            settings_completed,
            created_at
        from public.doctor
        where user_id = %s
        limit 1
    """, (g.current_user["user_id"],))

    return doctor


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


def get_day_name(day_number):
    names = {
        0: "Sunday",
        1: "Monday",
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday"
    }

    return names.get(day_number, f"Day {day_number}")


@doctor_settings_bp.get("/me")
@login_required(allowed_roles=["doctor"])
def doctor_me():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    return jsonify({
        "status": "ok",
        "message": "Doctor profile fetched.",
        "data": make_json_safe(doctor)
    })


@doctor_settings_bp.get("/settings")
@login_required(allowed_roles=["doctor"])
def get_doctor_settings():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    hospitals = fetch_all("""
        select
            id,
            doctor_id,
            name,
            address,
            city,
            is_active,
            created_at
        from public.doctor_hospital
        where doctor_id = %s
          and is_active = true
        order by created_at desc
    """, (doctor["doctor_id"],))

    schedules = fetch_all("""
        select
            s.schedule_id,
            s.doctor_hospital_id,
            dh.name as hospital_name,
            s.day_of_week,
            s.start_time,
            s.end_time,
            s.default_consultation_minutes,
            s.consultation_fee,
            s.is_active,
            s.created_at
        from public.doctor_hospital_schedule s
        join public.doctor_hospital dh
          on dh.id = s.doctor_hospital_id
        where dh.doctor_id = %s
          and s.is_active = true
        order by s.day_of_week, s.start_time
    """, (doctor["doctor_id"],))

    form_fields = fetch_all("""
        select
            field_id,
            doctor_id,
            field_context,
            field_key,
            field_label,
            field_type,
            is_required,
            options,
            default_value,
            placeholder,
            help_text,
            display_order,
            is_active,
            created_at
        from public.doctor_form_field
        where doctor_id = %s
          and is_active = true
        order by field_context, display_order, created_at
    """, (doctor["doctor_id"],))

    return jsonify({
        "status": "ok",
        "message": "Doctor settings fetched.",
        "data": make_json_safe({
            "doctor": doctor,
            "hospitals": hospitals,
            "schedules": schedules,
            "form_fields": form_fields
        })
    })


@doctor_settings_bp.post("/hospitals")
@login_required(allowed_roles=["doctor"])
def add_hospital():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    name = clean_text(data.get("name"))
    address = clean_text(data.get("address"))
    city = clean_text(data.get("city"))

    if not name:
        return jsonify({
            "status": "error",
            "message": "Hospital/clinic name is required."
        }), 400

    if not city:
        return jsonify({
            "status": "error",
            "message": "City is required."
        }), 400

    existing = fetch_one("""
        select id
        from public.doctor_hospital
        where doctor_id = %s
          and lower(name) = lower(%s)
          and lower(coalesce(city, '')) = lower(%s)
          and is_active = true
        limit 1
    """, (
        doctor["doctor_id"],
        name,
        city
    ))

    if existing:
        return jsonify({
            "status": "error",
            "message": "This hospital/clinic already exists for your profile."
        }), 409

    rows = execute_query("""
        insert into public.doctor_hospital
        (doctor_id, name, address, city, is_active)
        values (%s, %s, %s, %s, true)
        returning
            id,
            doctor_id,
            name,
            address,
            city,
            is_active,
            created_at
    """, (
        doctor["doctor_id"],
        name,
        address,
        city
    ))

    return jsonify({
        "status": "ok",
        "message": "Hospital/clinic added successfully.",
        "data": make_json_safe(first_row(rows))
    }), 201


@doctor_settings_bp.post("/hospitals/<int:hospital_id>/schedules")
@login_required(allowed_roles=["doctor"])
def add_schedule(hospital_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    selected_days = data.get("day_of_weeks")
    single_day = data.get("day_of_week")

    if selected_days is None:
        selected_days = []

    if single_day is not None and not selected_days:
        selected_days = [single_day]

    start_time = clean_text(data.get("start_time"))
    end_time = clean_text(data.get("end_time"))
    default_consultation_minutes = data.get("default_consultation_minutes")
    consultation_fee = data.get("consultation_fee")

    hospital = fetch_one("""
        select id, doctor_id, name
        from public.doctor_hospital
        where id = %s
          and doctor_id = %s
          and is_active = true
        limit 1
    """, (
        hospital_id,
        doctor["doctor_id"]
    ))

    if not hospital:
        return jsonify({
            "status": "error",
            "message": "Hospital/clinic not found for this doctor."
        }), 404

    if not isinstance(selected_days, list) or len(selected_days) == 0:
        return jsonify({
            "status": "error",
            "message": "Select at least one day."
        }), 400

    parsed_days = []

    for day in selected_days:
        try:
            parsed_day = int(day)
        except (TypeError, ValueError):
            return jsonify({
                "status": "error",
                "message": "All selected days must be valid numbers."
            }), 400

        if parsed_day < 0 or parsed_day > 6:
            return jsonify({
                "status": "error",
                "message": "Day of week must be between 0 and 6."
            }), 400

        if parsed_day not in parsed_days:
            parsed_days.append(parsed_day)

    if not start_time or not end_time:
        return jsonify({
            "status": "error",
            "message": "Start time and end time are required."
        }), 400

    if start_time >= end_time:
        return jsonify({
            "status": "error",
            "message": "Start time must be before end time."
        }), 400

    try:
        default_consultation_minutes = int(default_consultation_minutes)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Default consultation duration must be a valid number."
        }), 400

    try:
        consultation_fee = int(consultation_fee)
    except (TypeError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Consultation fee must be a valid number."
        }), 400

    if default_consultation_minutes <= 0:
        return jsonify({
            "status": "error",
            "message": "Default consultation duration must be greater than zero."
        }), 400

    if consultation_fee < 0:
        return jsonify({
            "status": "error",
            "message": "Consultation fee cannot be negative."
        }), 400

    for day_of_week in parsed_days:
        overlapping_schedule = fetch_one("""
            select
                s.schedule_id,
                s.day_of_week,
                s.start_time,
                s.end_time,
                dh.name as hospital_name
            from public.doctor_hospital_schedule s
            join public.doctor_hospital dh
              on dh.id = s.doctor_hospital_id
            where s.doctor_hospital_id = %s
              and dh.doctor_id = %s
              and s.day_of_week = %s
              and s.is_active = true
              and (%s::time < s.end_time and %s::time > s.start_time)
            limit 1
        """, (
            hospital_id,
            doctor["doctor_id"],
            day_of_week,
            start_time,
            end_time
        ))

        if overlapping_schedule:
            return jsonify({
                "status": "error",
                "message": (
                    f"Schedule overlaps with an existing entry on "
                    f"{get_day_name(day_of_week)} at {hospital['name']}. "
                    f"Existing time: {make_json_safe(overlapping_schedule['start_time'])} "
                    f"to {make_json_safe(overlapping_schedule['end_time'])}."
                )
            }), 409

    inserted_schedules = []

    for day_of_week in parsed_days:
        rows = execute_query("""
            insert into public.doctor_hospital_schedule
            (
                doctor_hospital_id,
                day_of_week,
                start_time,
                end_time,
                default_consultation_minutes,
                consultation_fee,
                is_active
            )
            values (%s, %s, %s, %s, %s, %s, true)
            returning
                schedule_id,
                doctor_hospital_id,
                day_of_week,
                start_time,
                end_time,
                default_consultation_minutes,
                consultation_fee,
                is_active,
                created_at
        """, (
            hospital_id,
            day_of_week,
            start_time,
            end_time,
            default_consultation_minutes,
            consultation_fee
        ))

        inserted_schedules.append(first_row(rows))

    return jsonify({
        "status": "ok",
        "message": f"{len(inserted_schedules)} schedule entry/entries added successfully.",
        "data": make_json_safe(inserted_schedules)
    }), 201


@doctor_settings_bp.delete("/schedules/<int:schedule_id>")
@login_required(allowed_roles=["doctor"])
def delete_schedule(schedule_id):
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    schedule = fetch_one("""
        select
            s.schedule_id,
            s.doctor_hospital_id,
            s.day_of_week,
            s.start_time,
            s.end_time,
            s.is_active,
            dh.doctor_id,
            dh.name as hospital_name
        from public.doctor_hospital_schedule s
        join public.doctor_hospital dh
          on dh.id = s.doctor_hospital_id
        where s.schedule_id = %s
          and dh.doctor_id = %s
        limit 1
    """, (
        schedule_id,
        doctor["doctor_id"]
    ))

    if not schedule:
        return jsonify({
            "status": "error",
            "message": "Schedule entry not found."
        }), 404

    if not schedule["is_active"]:
        return jsonify({
            "status": "error",
            "message": "Schedule entry is already deleted."
        }), 409

    rows = execute_query("""
        update public.doctor_hospital_schedule
        set is_active = false
        where schedule_id = %s
        returning
            schedule_id,
            doctor_hospital_id,
            day_of_week,
            start_time,
            end_time,
            is_active
    """, (schedule_id,))

    return jsonify({
        "status": "ok",
        "message": "Schedule entry deleted successfully.",
        "data": make_json_safe(first_row(rows))
    })


@doctor_settings_bp.post("/form-fields")
@login_required(allowed_roles=["doctor"])
def add_form_field():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    data = request.get_json(silent=True) or {}

    field_context = clean_text(data.get("field_context"))
    field_label = clean_text(data.get("field_label"))
    field_type = clean_text(data.get("field_type"))
    is_required = bool(data.get("is_required", False))
    placeholder = clean_text(data.get("placeholder"))
    help_text = clean_text(data.get("help_text"))
    display_order = data.get("display_order", 0)
    options = data.get("options")

    allowed_contexts = ["patient_intake", "consultation"]
    allowed_types = [
        "text",
        "number",
        "date",
        "time",
        "textarea",
        "select",
        "checkbox",
        "boolean"
    ]

    if field_context not in allowed_contexts:
        return jsonify({
            "status": "error",
            "message": "Field context must be patient_intake or consultation."
        }), 400

    if not field_label:
        return jsonify({
            "status": "error",
            "message": "Field label is required."
        }), 400

    if field_type not in allowed_types:
        return jsonify({
            "status": "error",
            "message": "Invalid field type."
        }), 400

    try:
        display_order = int(display_order)
    except (TypeError, ValueError):
        display_order = 0

    field_key = make_field_key(field_label)

    existing = fetch_one("""
        select field_id
        from public.doctor_form_field
        where doctor_id = %s
          and field_context = %s
          and field_key = %s
          and is_active = true
        limit 1
    """, (
        doctor["doctor_id"],
        field_context,
        field_key
    ))

    if existing:
        return jsonify({
            "status": "error",
            "message": "A field with this label already exists in this context."
        }), 409

    options_json = None

    if options is not None:
        options_json = json.dumps(options)

    rows = execute_query("""
        insert into public.doctor_form_field
        (
            doctor_id,
            field_context,
            field_key,
            field_label,
            field_type,
            is_required,
            options,
            placeholder,
            help_text,
            display_order,
            is_active
        )
        values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, true)
        returning
            field_id,
            doctor_id,
            field_context,
            field_key,
            field_label,
            field_type,
            is_required,
            options,
            placeholder,
            help_text,
            display_order,
            is_active,
            created_at
    """, (
        doctor["doctor_id"],
        field_context,
        field_key,
        field_label,
        field_type,
        is_required,
        options_json,
        placeholder,
        help_text,
        display_order
    ))

    return jsonify({
        "status": "ok",
        "message": "Dynamic form field added successfully.",
        "data": make_json_safe(first_row(rows))
    }), 201


@doctor_settings_bp.post("/settings/complete")
@login_required(allowed_roles=["doctor"])
def complete_settings():
    doctor, error = require_approved_doctor()

    if error:
        body, status_code = error
        return jsonify(body), status_code

    hospital_count = fetch_one("""
        select count(*) as total
        from public.doctor_hospital
        where doctor_id = %s
          and is_active = true
    """, (doctor["doctor_id"],))

    schedule_count = fetch_one("""
        select count(*) as total
        from public.doctor_hospital_schedule s
        join public.doctor_hospital dh
          on dh.id = s.doctor_hospital_id
        where dh.doctor_id = %s
          and s.is_active = true
    """, (doctor["doctor_id"],))

    if int(hospital_count["total"]) == 0:
        return jsonify({
            "status": "error",
            "message": "Add at least one hospital/clinic before completing settings."
        }), 400

    if int(schedule_count["total"]) == 0:
        return jsonify({
            "status": "error",
            "message": "Add at least one schedule before completing settings."
        }), 400

    rows = execute_query("""
        update public.doctor
        set settings_completed = true
        where doctor_id = %s
        returning
            doctor_id,
            name,
            specialization,
            approval_status,
            settings_completed
    """, (doctor["doctor_id"],))

    return jsonify({
        "status": "ok",
        "message": "Doctor settings marked as completed.",
        "data": make_json_safe(first_row(rows))
    })