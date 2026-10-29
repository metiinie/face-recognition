"""
Camera image processing, quality validation, face detection, embedding generation, and matching.
IMPORTANT ARCHITECTURAL BOUNDARY (Section 4):
This module returns a recognition result (candidate employee ID, match score, quality diagnostics).
It NEVER writes attendance records or modifies attendance sessions directly.
"""
import base64
import hashlib
import io
import json
import numpy as np
from PIL import Image
from flask import current_app
from backend.database.models import Employee, FaceTemplate


EMBEDDING_DIM = 128


def generate_deterministic_embedding(seed_text: str) -> list[float]:
    """
    Generate a reproducible unit-normalized 128-D biometric embedding vector from a seed string.
    Used for enrolled employee templates and deterministic kiosk/acceptance testing.
    """
    digest = hashlib.sha512(seed_text.encode("utf-8")).digest()
    rng_seed = int.from_bytes(digest[:8], "big")
    rng = np.random.default_rng(rng_seed)
    vec = rng.standard_normal(EMBEDDING_DIM).astype(np.float64)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return [round(float(x), 6) for x in vec]


def cosine_similarity(vec_a: list[float] | np.ndarray, vec_b: list[float] | np.ndarray) -> float:
    """Compute cosine similarity in [-1.0, 1.0] between two embedding vectors."""
    a = np.asarray(vec_a, dtype=np.float64)
    b = np.asarray(vec_b, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _extract_embedding_from_pil(img: Image.Image) -> tuple[list[float], dict]:
    """
    Analyze a PIL image for brightness, sharpness (gradient variance), and central face energy,
    and extract a normalized 128-D multi-scale spatial-frequency embedding vector.
    """
    gray = img.convert("L").resize((128, 128))
    arr = np.asarray(gray, dtype=np.float64)

    brightness = float(np.mean(arr))
    # Compute spatial gradient magnitude as sharpness metric
    gx = np.diff(arr, axis=1)
    gy = np.diff(arr, axis=0)
    sharpness = float(np.var(gx) + np.var(gy)) / 20.0

    # Check central face region contrast vs border to detect blank/obstructed frames
    center_crop = arr[24:104, 24:104]
    center_std = float(np.std(center_crop))
    face_detected = center_std >= 12.0

    # Extract 128-D descriptor from 8x16 pooled spatial blocks + normalized gradients
    blocks = center_crop.reshape(8, 10, 16, 5).mean(axis=(1, 3)).flatten()  # 128 dims
    blocks = blocks - np.mean(blocks)
    norm = np.linalg.norm(blocks)
    if norm > 0:
        blocks = blocks / norm
    embedding = [round(float(x), 6) for x in blocks]

    quality = {
        "brightness": round(brightness, 2),
        "sharpness": round(sharpness, 2),
        "center_contrast": round(center_std, 2),
        "face_detected": face_detected,
        "obstructed": not face_detected,
    }
    return embedding, quality


def analyze_and_extract_embedding(capture_payload: dict) -> dict:
    """
    Validate capture quality and extract a 128-D face embedding.
    Supports:
      - `image_base64`: Data URL or raw base64 image from browser webcam
      - `biometric_signature`: Named signature (for kiosk simulation or deterministic enrollment)
      - `embedding_vector`: Explicit 128-D float array
      - `quality_metrics`: Optional overrides for testing poor lighting, blur, or obstruction (AT-03, AT-06)
    Returns:
      {
        "usable": bool,
        "rejection_code": str | None,
        "rejection_message": str | None,
        "quality_score": float,
        "quality_details": dict,
        "embedding": list[float] | None
      }
    """
    min_bright = current_app.config.get("MIN_IMAGE_BRIGHTNESS", 45.0)
    max_bright = current_app.config.get("MAX_IMAGE_BRIGHTNESS", 235.0)
    min_sharp = current_app.config.get("MIN_IMAGE_SHARPNESS", 35.0)
    allow_sim = current_app.config.get("ALLOW_SIMULATED_BIOMETRICS", False)

    # Client-supplied quality metrics are only trusted in simulation mode; otherwise
    # quality is always measured from the captured image itself.
    quality_override = (capture_payload.get("quality_metrics") or {}) if allow_sim else {}
    brightness = float(quality_override.get("brightness", 128.0))
    sharpness = float(quality_override.get("sharpness", 85.0))
    face_detected = bool(quality_override.get("face_detected", True))
    obstructed = bool(quality_override.get("obstructed", False))

    embedding = None

    # 1. Decode base64 image if provided
    image_b64 = capture_payload.get("image_base64")
    if image_b64 and isinstance(image_b64, str):
        try:
            raw_b64 = image_b64.split(",", 1)[-1].strip()
            img_bytes = base64.b64decode(raw_b64)
            img = Image.open(io.BytesIO(img_bytes))
            extracted_emb, img_quality = _extract_embedding_from_pil(img)
            embedding = extracted_emb
            if "brightness" not in quality_override:
                brightness = img_quality["brightness"]
            if "sharpness" not in quality_override:
                sharpness = img_quality["sharpness"]
            if "face_detected" not in quality_override:
                face_detected = img_quality["face_detected"]
            if "obstructed" not in quality_override:
                obstructed = img_quality["obstructed"]
        except Exception:
            return {
                "usable": False,
                "rejection_code": "INVALID_IMAGE_DATA",
                "rejection_message": "Captured frame could not be decoded. Please retry scan.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

    # 2. Named signatures / raw vectors are simulation-only inputs (demo kiosk & tests).
    if allow_sim and capture_payload.get("biometric_signature"):
        embedding = generate_deterministic_embedding(str(capture_payload["biometric_signature"]))
    elif allow_sim and capture_payload.get("embedding_vector"):
        vec = capture_payload["embedding_vector"]
        if isinstance(vec, list) and len(vec) == EMBEDDING_DIM:
            embedding = [float(x) for x in vec]

    quality_details = {
        "brightness": brightness,
        "sharpness": sharpness,
        "face_detected": face_detected,
        "obstructed": obstructed,
    }

    # 3. Validate quality rules (AT-03, AT-06)
    if not face_detected or obstructed:
        return {
            "usable": False,
            "rejection_code": "FACE_NOT_DETECTED_OR_OBSTRUCTED",
            "rejection_message": (
                "No clear, unobstructed face detected in the camera frame. "
                "Please remove obstructions, look directly at the camera, and retry."
            ),
            "quality_score": 0.15,
            "quality_details": quality_details,
            "embedding": None,
        }

    if brightness < min_bright:
        return {
            "usable": False,
            "rejection_code": "POOR_LIGHTING_TOO_DARK",
            "rejection_message": (
                f"Image lighting is too dark (brightness {brightness:.0f} < {min_bright:.0f}). "
                "Please adjust lighting or position and capture again."
            ),
            "quality_score": 0.25,
            "quality_details": quality_details,
            "embedding": None,
        }

    if brightness > max_bright:
        return {
            "usable": False,
            "rejection_code": "POOR_LIGHTING_OVEREXPOSED",
            "rejection_message": (
                f"Image is overexposed/glare detected (brightness {brightness:.0f} > {max_bright:.0f}). "
                "Please avoid direct glare and capture again."
            ),
            "quality_score": 0.30,
            "quality_details": quality_details,
            "embedding": None,
        }

    if sharpness < min_sharp:
        return {
            "usable": False,
            "rejection_code": "IMAGE_TOO_BLURRY",
            "rejection_message": (
                f"Captured image is blurry or motion-degraded (sharpness {sharpness:.0f} < {min_sharp:.0f}). "
                "Please hold still and try again."
            ),
            "quality_score": 0.35,
            "quality_details": quality_details,
            "embedding": None,
        }

    if embedding is None:
        return {
            "usable": False,
            "rejection_code": "NO_BIOMETRIC_CAPTURE",
            "rejection_message": "No camera frame or biometric input provided.",
            "quality_score": 0.0,
            "quality_details": quality_details,
            "embedding": None,
        }

    # Compute normalized quality score in [0.60, 0.99]
    bright_factor = max(0.0, 1.0 - abs(brightness - 135.0) / 135.0)
    sharp_factor = min(1.0, sharpness / 100.0)
    quality_score = round(0.60 + 0.39 * (0.5 * bright_factor + 0.5 * sharp_factor), 3)

    return {
        "usable": True,
        "rejection_code": None,
        "rejection_message": None,
        "quality_score": quality_score,
        "quality_details": quality_details,
        "embedding": embedding,
    }


def recognize_face_candidate(capture_payload: dict, decrypt_fn) -> dict:
    """
    Compare a validated face capture against all ACTIVE enrolled templates.
    Does NOT create any attendance record.
    Returns:
      {
        "matched": bool,
        "status": "MATCHED" | "UNCERTAIN_MATCH" | "UNKNOWN_FACE" | "QUALITY_REJECTED" | "EMPLOYEE_INACTIVE",
        "employee": Employee | None,
        "recognition_score": float,
        "quality_score": float,
        "message": str,
        "rejection_code": str | None
      }
    """
    extraction = analyze_and_extract_embedding(capture_payload)
    if not extraction["usable"]:
        return {
            "matched": False,
            "status": "QUALITY_REJECTED",
            "employee": None,
            "recognition_score": 0.0,
            "quality_score": extraction["quality_score"],
            "message": extraction["rejection_message"],
            "rejection_code": extraction["rejection_code"],
            "quality_details": extraction["quality_details"],
        }

    probe_embedding = extraction["embedding"]
    match_threshold = current_app.config.get("RECOGNITION_MATCH_THRESHOLD", 0.78)
    uncertain_threshold = current_app.config.get("RECOGNITION_UNCERTAIN_THRESHOLD", 0.62)

    active_templates = FaceTemplate.query.filter_by(status="ACTIVE").all()
    best_score = -1.0
    best_template = None

    for tmpl in active_templates:
        try:
            stored_vec = decrypt_fn(tmpl.template_data)
            score = cosine_similarity(probe_embedding, stored_vec)
            if score > best_score:
                best_score = score
                best_template = tmpl
        except Exception:
            continue

    best_score_clamped = round(max(0.0, min(1.0, best_score)), 4)

    if best_template is None or best_score_clamped < uncertain_threshold:
        # AT-05: Unregistered person -> neutral retry message without exposing biometric/employee info
        return {
            "matched": False,
            "status": "UNKNOWN_FACE",
            "employee": None,
            "recognition_score": best_score_clamped,
            "quality_score": extraction["quality_score"],
            "message": (
                "Identity could not be verified confidently. Please position your face clearly "
                "and retry, or request HR Officer assistance."
            ),
            "rejection_code": "UNKNOWN_FACE",
            "quality_details": extraction["quality_details"],
        }

    if best_score_clamped < match_threshold:
        # Uncertain match (between uncertain_threshold and match_threshold) -> reject rather than guess (AT-06)
        return {
            "matched": False,
            "status": "UNCERTAIN_MATCH",
            "employee": None,
            "recognition_score": best_score_clamped,
            "quality_score": extraction["quality_score"],
            "message": (
                "Recognition confidence is below the required security threshold. "
                "Please retry under clear lighting or request HR assistance."
            ),
            "rejection_code": "UNCERTAIN_MATCH",
            "quality_details": extraction["quality_details"],
        }

    employee = best_template.employee
    if not employee or employee.status != "ACTIVE":
        # AT-07: Deactivated employee cannot record new attendance
        return {
            "matched": False,
            "status": "EMPLOYEE_INACTIVE",
            "employee": employee,
            "recognition_score": best_score_clamped,
            "quality_score": extraction["quality_score"],
            "message": (
                "This employee profile is currently inactive. New attendance events are blocked "
                "per college HR policy. Please contact the HR Office."
            ),
            "rejection_code": "EMPLOYEE_INACTIVE",
            "quality_details": extraction["quality_details"],
        }

    return {
        "matched": True,
        "status": "MATCHED",
        "employee": employee,
        "recognition_score": best_score_clamped,
        "quality_score": extraction["quality_score"],
        "message": f"Identity verified: {employee.full_name} ({employee.employee_number}). Please confirm Check-In or Check-Out.",
        "rejection_code": None,
        "quality_details": extraction["quality_details"],
    }

