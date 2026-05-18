import os
from datetime import datetime, timezone

from flask import Flask, jsonify, request, make_response
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
from patient_portal_routes import patient_portal_bp, pa_online_requests_bp
from doctor_appointment_finance_routes import doctor_appointment_finance_bp
from payment_routes import payment_bp


load_dotenv()

app = Flask(__name__)

APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "dev-secret-key-change-this-now")
APP_ENV = os.getenv("APP_ENV", "development")
CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "*")

app.config["SECRET_KEY"] = APP_SECRET_KEY


if CORS_ALLOWED_ORIGINS == "*":
    allowed_origins = "*"
else:
    allowed_origins = [
        origin.strip()
        for origin in CORS_ALLOWED_ORIGINS.split(",")
        if origin.strip()
    ]


CORS(
    app,
    resources={r"/*": {"origins": allowed_origins}},
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Type", "Authorization"],
    supports_credentials=False
)


@app.before_request
def handle_preflight_request():
    if request.method == "OPTIONS":
        response = make_response("", 204)
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "86400"
        return response


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return response


socketio = SocketIO(
    app,
    cors_allowed_origins=allowed_origins,
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
app.register_blueprint(patient_portal_bp)
app.register_blueprint(pa_online_requests_bp)
app.register_blueprint(doctor_appointment_finance_bp)
app.register_blueprint(payment_bp)


@app.get("/")
def root():
    return jsonify({
        "status": "ok",
        "message": "Hikmat Markaz backend API is running",
        "environment": APP_ENV,
        "docs": {
            "health": "/api/health",
            "database": "/api/health/db",
            "sync": "/api/sync/ping",

            "login": "/api/auth/login",
            "patient_login": "/api/patient/login",
            "me": "/api/auth/me",

            "doctor_signup": "/api/doctors/signup",
            "doctor_signup_status": "/api/doctors/signup-status?email=",

            "admin_pending_doctors": "/api/admin/doctors/pending",
            "admin_all_doctors": "/api/admin/doctors",
            "admin_dashboard_summary": "/api/admin/dashboard-summary",

            "doctor_settings": "/api/doctor/settings",
            "doctor_queue": "/api/doctor/queue?date=",
            "doctor_appointments": "/api/doctor/appointments",
            "doctor_finance_summary": "/api/doctor/finance/summary",

            "unified_payment_update": "/api/appointments/<appointment_id>/payment",

            "prescriptions_by_cnic": "/api/prescriptions/by-cnic?cnic=",
            "prescription_by_visit": "/api/prescriptions/visits/<visit_id>",
            "prescription_print_log": "/api/prescriptions/visits/<visit_id>/print-log",

            "patient_signup": "/api/patient/signup",
            "patient_appointments": "/api/patient/appointments",
            "patient_prescriptions": "/api/patient/prescriptions",
            "patient_create_appointment_request": "/api/patient/appointment-requests",

            "pa_online_requests": "/api/pa/appointment-requests"
        }
    })


@app.get("/api/health")
def health_check():
    return jsonify({
        "status": "ok",
        "message": "Hikmat Markaz backend is running",
        "environment": APP_ENV,
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
    debug_enabled = APP_ENV != "production"

    print(f"Starting Hikmat Markaz backend on http://127.0.0.1:{port}")

    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=debug_enabled,
        allow_unsafe_werkzeug=True
    )