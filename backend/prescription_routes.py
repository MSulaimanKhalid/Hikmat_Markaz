from datetime import date, datetime, time
from decimal import Decimal
import json

from flask import Blueprint, request, jsonify, g

from db import fetch_one, fetch_all, execute_query, transaction
from auth import login_required


prescription_bp = Blueprint(
    "prescription",
    __name__,
    url_prefix="/api/prescriptions"
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


def get_patient_by_cnic(cnic):
    normalized_cnic = "".join(ch for ch in cnic if ch.isdigit())

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
            created_at,
            updated_at
        from public.patient
        where cnic = %s
        limit 1
    """, (normalized_cnic,))


def get_completed_visits_for_patient(patient_id):
    return fetch_all("""
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
            a.appointment_datetime,
            a.status as appointment_status,
            a.fee_status,
            a.fee_charged,
            d.name as doctor_name,
            d.specialization,
            d.license_number,
            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city,
            dg.diagnosis_id,
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
    """, (patient_id,))


def get_prescription_detail_by_visit(visit_id):
    return fetch_one("""
        select
            v.visit_id,
            v.appointment_id,
            v.patient_id,
            v.doctor_id,
            v.started_at,
            v.completed_at,
            v.clinical_notes,
            v.bp,
            v.pulse,
            v.temperature,
            v.weight,

            p.cnic as patient_cnic,
            p.name as patient_name,
            p.gender as patient_gender,
            p.dob as patient_dob,
            p.phone as patient_phone,
            p.email as patient_email,

            a.appointment_datetime,
            a.duration_minutes,
            a.fee_charged,
            a.fee_status,
            a.status as appointment_status,
            a.source,
            a.notes as appointment_notes,

            d.name as doctor_name,
            d.specialization,
            d.license_number,

            dh.name as hospital_name,
            dh.address as hospital_address,
            dh.city as hospital_city,

            dg.diagnosis_id,
            dg.diagnosis_text,
            dg.treatment_plan,
            dg.follow_up_notes,
            dg.created_at as diagnosis_created_at
        from public.visit v
        join public.patient p
          on p.patient_id = v.patient_id
        join public.appointment a
          on a.appointment_id = v.appointment_id
        join public.doctor d
          on d.doctor_id = v.doctor_id
        join public.doctor_hospital dh
          on dh.id = a.doctor_hospital_id
        left join public.diagnosis dg
          on dg.visit_id = v.visit_id
        where v.visit_id = %s
        limit 1
    """, (visit_id,))


def get_dynamic_values_for_visit(visit_id):
    return fetch_all("""
        select
            vfv.field_value_id,
            vfv.visit_id,
            vfv.field_id,
            vfv.value_text,
            coalesce(vfv.field_label_snapshot, dff.field_label) as field_label,
            coalesce(vfv.field_type_snapshot, dff.field_type) as field_type,
            coalesce(vfv.field_context_snapshot, dff.field_context) as field_context,
            dff.field_key
        from public.visit_field_value vfv
        left join public.doctor_form_field dff
          on dff.field_id = vfv.field_id
        where vfv.visit_id = %s
        order by dff.display_order, dff.created_at, vfv.field_value_id
    """, (visit_id,))


def get_print_logs_for_visit(visit_id):
    return fetch_all("""
        select
            log_id,
            visit_id,
            appointment_id,
            patient_id,
            printed_by_user_id,
            printed_by_role,
            printed_at
        from public.prescription_print_log
        where visit_id = %s
        order by printed_at desc
        limit 10
    """, (visit_id,))


@prescription_bp.get("/by-cnic")
@login_required(allowed_roles=["pa", "doctor", "admin"])
def get_prescriptions_by_cnic():
    cnic = clean_text(request.args.get("cnic"))

    if not cnic:
        return jsonify({
            "status": "error",
            "message": "Patient CNIC is required."
        }), 400

    patient = get_patient_by_cnic(cnic)

    if not patient:
        return jsonify({
            "status": "ok",
            "message": "Patient not found.",
            "data": {
                "patient": None,
                "visits": []
            }
        })

    visits = get_completed_visits_for_patient(patient["patient_id"])

    return jsonify({
        "status": "ok",
        "message": "Prescription history fetched.",
        "data": make_json_safe({
            "patient": patient,
            "visits": visits
        })
    })


@prescription_bp.get("/visits/<int:visit_id>")
@login_required(allowed_roles=["pa", "doctor", "admin", "patient"])
def get_prescription_by_visit(visit_id):
    prescription = get_prescription_detail_by_visit(visit_id)

    if not prescription:
        return jsonify({
            "status": "error",
            "message": "Prescription/visit not found."
        }), 404

    if prescription["appointment_status"] != "completed":
        return jsonify({
            "status": "error",
            "message": "Prescription is available only after consultation is completed."
        }), 409

    if g.current_user["role"] == "patient":
        patient_owner = fetch_one("""
            select patient_id
            from public.patient
            where user_id = %s
            limit 1
        """, (g.current_user["user_id"],))

        if not patient_owner or patient_owner["patient_id"] != prescription["patient_id"]:
            return jsonify({
                "status": "error",
                "message": "You are not allowed to view this prescription."
            }), 403

    dynamic_values = get_dynamic_values_for_visit(visit_id)
    print_logs = get_print_logs_for_visit(visit_id)

    return jsonify({
        "status": "ok",
        "message": "Prescription fetched.",
        "data": make_json_safe({
            "prescription": prescription,
            "dynamic_values": dynamic_values,
            "print_logs": print_logs
        })
    })


@prescription_bp.post("/visits/<int:visit_id>/print-log")
@login_required(allowed_roles=["pa", "doctor", "admin"])
def log_prescription_print(visit_id):
    prescription = get_prescription_detail_by_visit(visit_id)

    if not prescription:
        return jsonify({
            "status": "error",
            "message": "Prescription/visit not found."
        }), 404

    if prescription["appointment_status"] != "completed":
        return jsonify({
            "status": "error",
            "message": "Only completed prescriptions can be printed."
        }), 409

    dynamic_values = get_dynamic_values_for_visit(visit_id)

    snapshot_payload = make_json_safe({
        "prescription": prescription,
        "dynamic_values": dynamic_values,
        "snapshot_created_at": datetime.utcnow().isoformat(),
        "snapshot_created_by_user_id": g.current_user["user_id"],
        "snapshot_created_by_role": g.current_user["role"]
    })

    try:
        with transaction() as cursor:
            cursor.execute("""
                insert into public.prescription_print_log
                (
                    visit_id,
                    appointment_id,
                    patient_id,
                    printed_by_user_id,
                    printed_by_role
                )
                values (%s, %s, %s, %s, %s)
                returning
                    log_id,
                    visit_id,
                    appointment_id,
                    patient_id,
                    printed_by_user_id,
                    printed_by_role,
                    printed_at
            """, (
                prescription["visit_id"],
                prescription["appointment_id"],
                prescription["patient_id"],
                g.current_user["user_id"],
                g.current_user["role"]
            ))

            print_log = dict(cursor.fetchone())

            cursor.execute("""
                insert into public.prescription_snapshot
                (
                    visit_id,
                    appointment_id,
                    patient_id,
                    doctor_id,
                    snapshot_json,
                    created_by_user_id,
                    created_by_role
                )
                values (%s, %s, %s, %s, %s::jsonb, %s, %s)
                returning
                    snapshot_id,
                    visit_id,
                    appointment_id,
                    patient_id,
                    doctor_id,
                    created_by_user_id,
                    created_by_role,
                    created_at
            """, (
                prescription["visit_id"],
                prescription["appointment_id"],
                prescription["patient_id"],
                prescription["doctor_id"],
                json.dumps(snapshot_payload),
                g.current_user["user_id"],
                g.current_user["role"]
            ))

            snapshot = dict(cursor.fetchone())

        return jsonify({
            "status": "ok",
            "message": "Prescription print logged and snapshot saved.",
            "data": make_json_safe({
                "print_log": print_log,
                "snapshot": snapshot
            })
        })

    except Exception as error:
        print("PRESCRIPTION SNAPSHOT ERROR:", str(error))

        return jsonify({
            "status": "error",
            "message": "Prescription print logging failed.",
            "error": str(error)
        }), 500