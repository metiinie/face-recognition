"""
Real-time Multi-Face Centroid and IoU Tracker for Continuous Entrance Gates.
Maintains persistent track IDs across successive video frames, computes
optical trajectories (motion vectors), enforces multi-frame persistence,
and protects against single-frame false attendance triggers.
"""
from datetime import datetime, timezone
import math


def compute_iou(box_a: dict, box_b: dict) -> float:
    """Compute Intersection-over-Union (IoU) between two bounding boxes {x, y, w, h}."""
    ax1, ay1, ax2, ay2 = box_a["x"], box_a["y"], box_a["x"] + box_a["w"], box_a["y"] + box_a["h"]
    bx1, by1, bx2, by2 = box_b["x"], box_b["y"], box_b["x"] + box_b["w"], box_b["y"] + box_b["h"]

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = box_a["w"] * box_a["h"]
    area_b = box_b["w"] * box_b["h"]
    union_area = area_a + area_b - inter_area

    if union_area <= 0:
        return 0.0
    return float(inter_area / union_area)


def compute_centroid_distance(c1: tuple[float, float], c2: tuple[float, float]) -> float:
    """Euclidean distance between two 2D centroids."""
    return math.hypot(c1[0] - c2[0], c1[1] - c2[1])


class TrackedFace:
    """Represents a persistent individual tracked across consecutive camera frames."""

    def __init__(self, track_id: int, bbox: dict, score: float, timestamp: datetime):
        self.track_id = track_id
        self.bbox = bbox  # {x, y, w, h}
        self.centroid = (bbox["x"] + bbox["w"] / 2.0, bbox["y"] + bbox["h"] / 2.0)
        self.area = bbox["w"] * bbox["h"]
        self.detection_score = score
        self.first_seen = timestamp
        self.last_seen = timestamp
        self.frames_seen = 1
        self.consecutive_misses = 0

        # Trajectory history: list of (timestamp, centroid, area)
        self.history = [(timestamp, self.centroid, self.area)]

        # Identity accumulation
        self.candidate_employee = None
        self.match_scores = []
        self.liveness_history = []

        # Attendance authorization state
        self.is_punch_committed = False
        self.committed_action = None
        self.committed_event_id = None

        # Trajectory vector
        self.motion_direction = "APPROACHING"  # APPROACHING, RECEDING, STATIONARY

    def update(self, bbox: dict, score: float, timestamp: datetime, candidate_emp: dict | None, match_score: float, liveness: bool):
        """Update track with new detection in the current frame."""
        self.bbox = bbox
        new_centroid = (bbox["x"] + bbox["w"] / 2.0, bbox["y"] + bbox["h"] / 2.0)
        new_area = bbox["w"] * bbox["h"]

        # Compute trajectory vector
        prev_centroid = self.centroid
        prev_area = self.area
        dy = new_centroid[1] - prev_centroid[1]
        d_area = new_area - prev_area

        # Update motion direction based on scale expansion & vertical translation
        # Scale growth > 2% indicates person approaching the gate camera
        if d_area > 0.02 * prev_area or dy > 4:
            self.motion_direction = "APPROACHING"
        elif d_area < -0.02 * prev_area or dy < -4:
            self.motion_direction = "RECEDING"
        else:
            self.motion_direction = "STATIONARY"

        self.centroid = new_centroid
        self.area = new_area
        self.detection_score = max(self.detection_score, score)
        self.last_seen = timestamp
        self.frames_seen += 1
        self.consecutive_misses = 0

        self.history.append((timestamp, self.centroid, self.area))
        if len(self.history) > 15:
            self.history.pop(0)

        if candidate_emp:
            self.candidate_employee = candidate_emp
        if match_score > 0:
            self.match_scores.append(match_score)
            if len(self.match_scores) > 10:
                self.match_scores.pop(0)

        self.liveness_history.append(liveness)
        if len(self.liveness_history) > 10:
            self.liveness_history.pop(0)

    @property
    def average_match_score(self) -> float:
        if not self.match_scores:
            return 0.0
        return sum(self.match_scores) / len(self.match_scores)

    @property
    def is_confirmed_live(self) -> bool:
        if not self.liveness_history:
            return True
        # At least 70% of frames must pass liveness
        return (sum(1 for x in self.liveness_history if x) / len(self.liveness_history)) >= 0.70

    @property
    def track_duration_seconds(self) -> float:
        return (self.last_seen - self.first_seen).total_seconds()


class ContinuousMultiFaceTracker:
    """
    Station-level Multi-Object Tracker (MOT).
    Performs spatial association between incoming detections and existing active tracks.
    """

    def __init__(self, station_code: str, max_age_seconds: float = 5.0, min_iou: float = 0.20):
        self.station_code = station_code
        self.max_age_seconds = max_age_seconds
        self.min_iou = min_iou
        self._next_track_id = 1
        self.active_tracks: dict[int, TrackedFace] = {}

    def process_frame_detections(self, detections: list[dict], timestamp: datetime) -> list[dict]:
        """
        Associate frame detections with active tracks.
        detections format:
          [{ 'bounding_box': {x, y, w, h}, 'score': float, 'employee': dict, 'recognition_score': float, 'liveness_passed': bool, ... }]
        Returns enriched detections with persistent track_id, frames_seen, and trajectory.
        """
        # Purge stale tracks older than max_age_seconds
        to_purge = [
            tid for tid, track in self.active_tracks.items()
            if (timestamp - track.last_seen).total_seconds() > self.max_age_seconds
        ]
        for tid in to_purge:
            del self.active_tracks[tid]

        unmatched_detections = list(range(len(detections)))
        unmatched_tracks = set(self.active_tracks.keys())
        matches = []

        # 1. Match using IoU and centroid proximity
        for d_idx, det in enumerate(detections):
            det_box = det.get("bounding_box", {})
            best_iou = 0.0
            best_track_id = None

            for tid in unmatched_tracks:
                track = self.active_tracks[tid]
                iou = compute_iou(det_box, track.bbox)
                if iou > best_iou and iou >= self.min_iou:
                    best_iou = iou
                    best_track_id = tid

            # Fallback to centroid proximity if IoU is slight due to rapid walking
            if best_track_id is None and det_box.get("w", 0) > 0:
                det_c = (det_box["x"] + det_box["w"] / 2.0, det_box["y"] + det_box["h"] / 2.0)
                best_dist = 90.0  # max 90 pixels centroid drift
                for tid in unmatched_tracks:
                    track = self.active_tracks[tid]
                    dist = compute_centroid_distance(det_c, track.centroid)
                    if dist < best_dist:
                        best_dist = dist
                        best_track_id = tid

            if best_track_id is not None:
                matches.append((best_track_id, d_idx))
                unmatched_tracks.remove(best_track_id)
                unmatched_detections.remove(d_idx)

        # 2. Update matched tracks
        for tid, d_idx in matches:
            det = detections[d_idx]
            track = self.active_tracks[tid]
            track.update(
                bbox=det.get("bounding_box", {}),
                score=det.get("quality_score", 0.8),
                timestamp=timestamp,
                candidate_emp=det.get("employee"),
                match_score=det.get("recognition_score", 0.0),
                liveness=det.get("liveness_passed", True),
            )
            # Enrich detection with persistent tracking state
            det["track_id"] = track.track_id
            det["frames_seen"] = track.frames_seen
            det["track_duration_sec"] = round(track.track_duration_seconds, 2)
            det["motion_direction"] = track.motion_direction
            det["is_punch_committed"] = track.is_punch_committed
            det["average_match_score"] = round(track.average_match_score, 4)

        # 3. Create new tracks for unmatched detections
        for d_idx in unmatched_detections:
            det = detections[d_idx]
            tid = self._next_track_id
            self._next_track_id += 1
            new_track = TrackedFace(
                track_id=tid,
                bbox=det.get("bounding_box", {}),
                score=det.get("quality_score", 0.8),
                timestamp=timestamp,
            )
            if det.get("employee"):
                new_track.candidate_employee = det["employee"]
            if det.get("recognition_score", 0) > 0:
                new_track.match_scores.append(det["recognition_score"])
            new_track.liveness_history.append(det.get("liveness_passed", True))

            self.active_tracks[tid] = new_track
            det["track_id"] = tid
            det["frames_seen"] = 1
            det["track_duration_sec"] = 0.0
            det["motion_direction"] = "APPROACHING"
            det["is_punch_committed"] = False
            det["average_match_score"] = round(det.get("recognition_score", 0.0), 4)

        return detections

    def mark_punch_committed(self, track_id: int, action: str, event_id: str):
        """Mark an active track as punched so it cannot fire duplicate writes during passage."""
        if track_id in self.active_tracks:
            track = self.active_tracks[track_id]
            track.is_punch_committed = True
            track.committed_action = action
            track.committed_event_id = event_id

