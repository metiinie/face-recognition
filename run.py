"""
Entrypoint to run the Ethio-Italy Polytechnic College Face Recognition Attendance System.
Usage:
  python run.py
"""
import os
from backend import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
