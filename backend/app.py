import os
from datetime import datetime, timezone

from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

from db import fetch_one
from auth_routes import auth_bp
from doctor_routes import doctor_bp


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
            "doctor_signup_status": "/api/doctors/signup-status?email="
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