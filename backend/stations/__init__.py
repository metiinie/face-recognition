"""Departmental attendance station registration and trusted verification module."""
from backend.stations.service import (
    register_station,
    verify_trusted_station,
    resolve_station_from_binding,
)

__all__ = ["register_station", "verify_trusted_station", "resolve_station_from_binding"]

