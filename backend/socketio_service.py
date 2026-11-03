"""
WebSocket Real-time Communication Service for EIPC Attendance System.
Powers bidirectional camera frame streaming for continuous entrance terminals,
live gate passage feeds, and instant dashboard telemetry updates.
"""
import logging
from flask import request
from flask_socketio import SocketIO, emit, join_room, leave_room
from backend.database.models import AttendanceStation

logger = logging.getLogger(__name__)

socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=20,
    ping_interval=10,
    max_http_buffer_size=10 * 1024 * 1024,  # 10MB buffer for frames
)


def register_socket_events(sio: SocketIO):
    """Register WebSocket event listeners for real-time entrance streaming and telemetry."""

    @sio.on("connect")
    def handle_connect():
        logger.info(f"WebSocket client connected: {request.sid} (remote: {request.remote_addr})")
        emit("connection_ack", {"status": "CONNECTED", "sid": request.sid})

    @sio.on("disconnect")
    def handle_disconnect():
        logger.info(f"WebSocket client disconnected: {request.sid}")

    @sio.on("join_station")
    def handle_join_station(data):
        station_code = (data or {}).get("station_code", "ST-GATE-01").strip().upper()
        room = f"station_{station_code}"
        join_room(room)
        logger.info(f"Client {request.sid} joined room {room}")
        emit("joined_station", {"station_code": station_code, "room": room})

    @sio.on("leave_station")
    def handle_leave_station(data):
        station_code = (data or {}).get("station_code", "ST-GATE-01").strip().upper()
        room = f"station_{station_code}"
        leave_room(room)
        logger.info(f"Client {request.sid} left room {room}")

    @sio.on("process_frame")
    def handle_process_frame(data):
        """
        High-throughput real-time frame processing over WebSocket.
        Eliminates HTTP connection overhead and provides sub-100ms response latency.
        """
        from backend.continuous_entrance.service import process_continuous_entrance_frame

        data = data or {}
        st_code = data.get("station_code") or "ST-GATE-01"
        station = AttendanceStation.query.filter_by(station_code=str(st_code).strip().upper()).first()
        if not station:
            station = AttendanceStation.query.filter_by(status="ACTIVE").first()

        if not station:
            return {"error": "No active attendance station available for entrance gate.", "faces": []}

        gate_mode = data.get("gate_mode")
        res = process_continuous_entrance_frame(
            station=station,
            frame_payload=data,
            override_gate_mode=gate_mode,
        )

        # If any attendance punches were committed in this frame, broadcast immediately
        summary_actions = res.get("summary_actions", [])
        if summary_actions:
            passage_payload = {
                "station_code": station.station_code,
                "actions": summary_actions,
                "timestamp": res.get("timestamp"),
            }
            # Broadcast to everyone watching this station
            sio.emit("passage_event", passage_payload, room=f"station_{station.station_code}")
            # Broadcast to dashboard
            sio.emit("attendance_live_event", {
                "type": "CONTINUOUS_ENTRANCE_PUNCH",
                "station_code": station.station_code,
                "actions": summary_actions,
            })

        return res


def broadcast_attendance_event(event_type: str, data: dict):
    """Broadcast an attendance event to all listening WebSocket clients."""
    try:
        socketio.emit("attendance_live_event", {
            "type": event_type,
            "data": data,
        })
    except Exception as e:
        logger.warning(f"Failed to broadcast attendance event over WebSocket: {e}")

