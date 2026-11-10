"""
Entrypoint to run the Ethio-Italy Polytechnic College Face Recognition Attendance System.
Usage:
  cd backend
  python run.py
"""
import os
import sys

# Ensure backend and parent directory are on sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(backend_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    from backend import create_app
except ImportError:
    from __init__ import create_app

try:
    from backend.socketio_service import socketio
except ImportError:
    from socketio_service import socketio

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") != "production" and os.environ.get("DEBUG", "0") == "1"

    ssl_cert = os.environ.get("SSL_CERT_PATH")
    ssl_key = os.environ.get("SSL_KEY_PATH")

    # If --ssl passed or USE_SSL=1, discover default generated LAN certificates
    if "--ssl" in sys.argv or os.environ.get("USE_SSL") == "1":
        default_cert = os.path.join(backend_dir, "nginx", "ssl", "eipc.crt")
        default_key = os.path.join(backend_dir, "nginx", "ssl", "eipc.key")
        if os.path.exists(default_cert) and os.path.exists(default_key):
            ssl_cert = ssl_cert or default_cert
            ssl_key = ssl_key or default_key

    run_kwargs = {
        "host": "0.0.0.0",
        "port": port,
        "debug": debug,
        "allow_unsafe_werkzeug": True,
    }

    if ssl_cert and ssl_key and os.path.exists(ssl_cert) and os.path.exists(ssl_key):
        print(f"[*] Starting Flask-SocketIO with Institutional LAN TLS (HTTPS)")
        print(f"    - Certificate: {ssl_cert}")
        print(f"    - Key:         {ssl_key}")
        run_kwargs["certfile"] = ssl_cert
        run_kwargs["keyfile"] = ssl_key

    socketio.run(app, **run_kwargs)
