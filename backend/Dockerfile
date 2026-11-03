# Backend Dockerfile for EIPC Face Attendance Management System
FROM python:3.13-slim

WORKDIR /app

# Install system dependencies required for OpenCV and cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    opencv-python-headless \
    onnxruntime \
    pyjwt \
    flask-cors \
    flask-socketio \
    redis \
    gunicorn

# Copy application source code
COPY . .

EXPOSE 5000

ENV FLASK_ENV=production \
    PYTHONUNBUFFERED=1

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "120", "run:app"]

