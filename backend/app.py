import os
from datetime import datetime, timezone

from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

from db import fetch_one
from auth_routes import auth_bp
from doctor_routes import doctor_bp
from admin_routes import admin_bp
from doctor_settings_routes import doctor_settings_bp
from pa_routes import pa_bp
from pa_workspace_routes import pa_workspace_bp
from doctor_queue_routes import doctor_queue_bp
from prescription_routes import prescription_bp


load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("APP_SECRET_KEY", "dev-secret-key")

CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    supports_credentials=True
)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)

app.register_blueprint(auth_bp)
app.register_blueprint(doctor_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(doctor_settings_bp)
app.register_blueprint(pa_bp)
app.register_blueprint(pa_workspace_bp)
app.register_blueprint(doctor_queue_bp)
app.register_blueprint(prescription_bp)


@app.get("/")
def root():
    return jsonify({
        "status": "ok",
        "message": "Hikmat Markaz backend API is running",
        "docs": {
            "health": "/api/health",
            "database": "/api/health/db",
            "sync": "/api/sync/ping",

            "login": "/api/auth/login",
            "me": "/api/auth/me",

            "doctor_signup": "/api/doctors/signup",
            "doctor_signup_status": "/api/doctors/signup-status?email=",

            "admin_pending_doctors": "/api/admin/doctors/pending",
            "admin_all_doctors": "/api/admin/doctors",
            "admin_dashboard_summary": "/api/admin/dashboard-summary",

            "doctor_me": "/api/doctor/me",
            "doctor_settings": "/api/doctor/settings",
            "doctor_add_hospital": "/api/doctor/hospitals",
            "doctor_add_schedule": "/api/doctor/hospitals/<hospital_id>/schedules",
            "doctor_delete_schedule": "/api/doctor/schedules/<schedule_id>",
            "doctor_add_form_field": "/api/doctor/form-fields",
            "doctor_complete_settings": "/api/doctor/settings/complete",

            "doctor_pa_links": "/api/doctor/pa-links",
            "doctor_pa_invites": "/api/doctor/pa-invites",
            "public_pa_invite": "/api/pa/invites/<invite_token>",
            "accept_pa_invite": "/api/pa/invites/<invite_token>/accept",

            "pa_me": "/api/pa/me",
            "pa_assignments": "/api/pa/assignments",
            "pa_patient_search": "/api/pa/patients/search?cnic=",
            "pa_available_slots": "/api/pa/available-slots?assignment_id=",
            "pa_create_appointment": "/api/pa/appointments",
            "pa_appointments": "/api/pa/appointments?date=",

            "doctor_queue_filters": "/api/doctor/queue/filters",
            "doctor_queue": "/api/doctor/queue?date=",
            "doctor_mark_paid": "/api/doctor/appointments/<appointment_id>/mark-paid",
            "doctor_prioritize": "/api/doctor/appointments/<appointment_id>/prioritize",
            "doctor_start_consultation": "/api/doctor/appointments/<appointment_id>/start",
            "doctor_consultation_details": "/api/doctor/appointments/<appointment_id>/consultation",
            "doctor_complete_consultation": "/api/doctor/appointments/<appointment_id>/complete",

            "prescriptions_by_cnic": "/api/prescriptions/by-cnic?cnic=",
            "prescription_by_visit": "/api/prescriptions/visits/<visit_id>",
            "prescription_print_log": "/api/prescriptions/visits/<visit_id>/print-log"
        }
    })


@app.get("/api/health")
def health_check():
    return jsonify({
        "status": "ok",
        "message": "Hikmat Markaz backend is running",
        "server_time": datetime.now(timezone.utc).isoformat()
    })


@app.get("/api/health/db")
def database_health_check():
    try:
        row = fetch_one("""
            select
                now() as database_time,
                current_database() as database_name,
                current_schema() as schema_name
        """)

        return jsonify({
            "status": "ok",
            "message": "Database connection successful",
            "database": {
                "database_time": str(row["database_time"]),
                "database_name": row["database_name"],
                "schema_name": row["schema_name"]
            }
        })

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Database connection failed",
            "error": str(error)
        }), 500


@app.get("/api/sync/ping")
def sync_ping():
    try:
        row = fetch_one("select now() as database_time")

        return jsonify({
            "status": "ok",
            "message": "Sync endpoint is active",
            "database_time": str(row["database_time"]),
            "server_time": datetime.now(timezone.utc).isoformat()
        })

    except Exception as error:
        return jsonify({
            "status": "error",
            "message": "Sync endpoint failed",
            "error": str(error)
        }), 500


@socketio.on("connect")
def handle_socket_connect():
    emit("server_message", {
        "message": "Connected to Hikmat Markaz socket server"
    })


@socketio.on("disconnect")
def handle_socket_disconnect():
    print("Client disconnected")


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))

    print(f"Starting Hikmat Markaz backend on http://127.0.0.1:{port}")

    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=True,
        allow_unsafe_werkzeug=True
    )