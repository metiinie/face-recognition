"""Continuous Entrance (Option B / Version 2) Module."""
from backend.continuous_entrance.service import (
    ContinuousEntranceManager,
    process_continuous_entrance_frame,
)

__all__ = [
    "ContinuousEntranceManager",
    "process_continuous_entrance_frame",
]
