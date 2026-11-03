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
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, allow_unsafe_werkzeug=True)
