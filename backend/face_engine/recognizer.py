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
from flask import current_app, has_app_context
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
    Production-grade computer vision pipeline using Pillow and NumPy:
      1. Converts to RGB, validates dimensions and normalizes scale.
      2. Color segmentation in YCbCr chrominance space (Kovacs et al.).
      3. Face cluster analysis: identifies zero, single, or multiple face clusters.
      4. Face ROI alignment: crops bounding box with 20% margin and normalizes to 160x160 canonical space.
      5. Anti-spoofing / Liveness: checks chrominance depth, paper print flatness, screen glare, and Moiré subpixel frequency.
      6. Feature descriptor: extracts 128-D spatial gradient orientation descriptor, zero-mean centered for Pearson correlation.
    """
    img_rgb = img.convert("RGB")
    if img_rgb.width > 640 or img_rgb.height > 640:
        img_rgb.thumbnail((640, 640), Image.Resampling.BILINEAR)

    arr_rgb = np.asarray(img_rgb, dtype=np.float64)
    r, g, b = arr_rgb[:, :, 0], arr_rgb[:, :, 1], arr_rgb[:, :, 2]

    # Measure frame sharpness and subpixel Moiré frequency before ROI cropping/rescaling
    gray_raw = arr_rgb.mean(axis=2)
    if gray_raw.shape[0] > 2 and gray_raw.shape[1] > 2:
        laplacian_raw = (
            -4 * gray_raw[1:-1, 1:-1]
            + gray_raw[:-2, 1:-1]
            + gray_raw[2:, 1:-1]
            + gray_raw[1:-1, :-2]
            + gray_raw[1:-1, 2:]
        )
        sharpness = float(np.var(laplacian_raw)) / 15.0
        col_diff = np.abs(np.diff(gray_raw, axis=1))
        moire_score = float(np.var(col_diff) / (np.var(gray_raw) + 1e-4))
    else:
        sharpness = 0.0
        moire_score = 0.0

    # Convert to YCbCr color space for skin detection
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128.0
    cr = 0.5 * r - 0.4187 * g - 0.0813 * b + 128.0

    # Human skin-locus mask in chrominance space (Kovacs et al.)
    skin_mask = (cb >= 75.0) & (cb <= 140.0) & (cr >= 130.0) & (cr <= 185.0)
    skin_ratio = float(np.mean(skin_mask))

    # Face cluster detection (Zero vs Single vs Multiple faces)
    kernel_size = max(3, int(img_rgb.width * 0.05))
    col_proj = np.convolve(skin_mask.sum(axis=0), np.ones(kernel_size) / kernel_size, mode="same")
    peak_thresh = (np.max(col_proj) * 0.28) if (np.max(col_proj) > 0) else 1.0
    above = (col_proj > peak_thresh).astype(int)
    diff = np.diff(np.pad(above, (1, 1), "constant"))
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]
    min_cluster_w = max(14, int(img_rgb.width * 0.08))
    clusters = [(s, e) for s, e in zip(starts, ends) if (e - s) >= min_cluster_w]
    faces_count = len(clusters) if skin_ratio >= 0.02 else 0

    # Face Alignment and Cropping
    y_idx, x_idx = skin_mask.nonzero()
    if faces_count == 1 and len(y_idx) >= 80:
        y_min, y_max = np.percentile(y_idx, [2, 98])
        x_min, x_max = np.percentile(x_idx, [2, 98])
        h = y_max - y_min
        w = x_max - x_min
        cy = (y_min + y_max) / 2.0
        cx = (x_min + x_max) / 2.0
        side = max(h, w) * 1.25
        x1 = max(0, int(cx - side / 2))
        y1 = max(0, int(cy - side / 2))
        x2 = min(img_rgb.width, int(cx + side / 2))
        y2 = min(img_rgb.height, int(cy + side / 2))
        aligned_pil = img_rgb.crop((x1, y1, x2, y2)).resize((160, 160), Image.Resampling.BILINEAR)
    else:
        aligned_pil = img_rgb.resize((160, 160), Image.Resampling.BILINEAR)

    arr_aligned = np.asarray(aligned_pil, dtype=np.float64)
    r_a, g_a, b_a = arr_aligned[:, :, 0], arr_aligned[:, :, 1], arr_aligned[:, :, 2]
    gray = arr_aligned.mean(axis=2)
    brightness = float(np.mean(gray))

    cb_a = -0.1687 * r_a - 0.3313 * g_a + 0.5 * b_a + 128.0
    cr_a = 0.5 * r_a - 0.4187 * g_a - 0.0813 * b_a + 128.0

    face_detected = (faces_count == 1) or ((len(y_idx) >= 120) and (float(np.std(gray[30:130, 30:130])) >= 12.0))
    obstructed = (not face_detected) or (skin_ratio < 0.02)

    # Multi-factor Anti-spoofing / Liveness detection (Section 8, POL-04)
    inner_aligned = arr_aligned[55:105, 55:105]
    r_in, g_in, b_in = inner_aligned[:, :, 0], inner_aligned[:, :, 1], inner_aligned[:, :, 2]
    cb_in = -0.1687 * r_in - 0.3313 * g_in + 0.5 * b_in + 128.0
    cr_in = 0.5 * r_in - 0.4187 * g_in - 0.0813 * b_in + 128.0
    chroma_sum = float(np.std(cr_in) + np.std(cb_in))

    glare_ratio = float(np.mean(gray[20:140, 20:140] >= 250.0))

    spoof_detected = False
    spoof_type = None
    if glare_ratio > 0.18:
        spoof_detected = True
        spoof_type = "SCREEN_GLARE_REPLAY_DETECTED"
    elif moire_score > 1.0:
        spoof_detected = True
        spoof_type = "SCREEN_MOIRE_REPLAY_DETECTED"
    elif chroma_sum < 1.8:
        spoof_detected = True
        spoof_type = "PRINTED_PHOTO_DETECTED"

    liveness_score = round(
        min(1.0, max(0.05, (min(sharpness, 100.0) / 100.0) * 0.4 + (min(chroma_sum, 30.0) / 30.0) * 0.4 + (1.0 - min(glare_ratio * 10, 1.0)) * 0.2)),
        3
    )
    liveness_passed = (not spoof_detected) and (liveness_score >= 0.30)

    # Extract 128-D spatial gradient orientation descriptor (16 cells x 8 bins)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)
    gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
    gy = np.pad(gy, ((0, 1), (0, 0)), mode="edge")[16:144, 16:144]

    magnitude = np.sqrt(gx**2 + gy**2)
    orientation = (np.arctan2(gy, gx) * (180.0 / np.pi)) % 180.0

    cell_h, cell_w = 32, 32
    descriptor_128 = []
    for cy in range(4):
        for cx in range(4):
            c_mag = magnitude[cy * cell_h : (cy + 1) * cell_h, cx * cell_w : (cx + 1) * cell_w]
            c_ori = orientation[cy * cell_h : (cy + 1) * cell_h, cx * cell_w : (cx + 1) * cell_w]
            hist, _ = np.histogram(c_ori, bins=8, range=(0.0, 180.0), weights=c_mag)
            descriptor_128.extend(hist.tolist())

    vec = np.asarray(descriptor_128, dtype=np.float64)
    vec = vec - np.mean(vec)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    embedding = [round(float(val), 6) for val in vec]

    quality = {
        "brightness": round(brightness, 2),
        "sharpness": round(sharpness, 2),
        "skin_ratio": round(skin_ratio, 3),
        "liveness_score": liveness_score,
        "liveness_passed": liveness_passed,
        "spoof_detected": spoof_detected,
        "spoof_type": spoof_type,
        "faces_count": faces_count,
        "face_detected": face_detected,
        "obstructed": obstructed,
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
    if has_app_context():
        min_bright = current_app.config.get("MIN_IMAGE_BRIGHTNESS", 45.0)
        max_bright = current_app.config.get("MAX_IMAGE_BRIGHTNESS", 235.0)
        min_sharp = current_app.config.get("MIN_IMAGE_SHARPNESS", 35.0)
        allow_sim = current_app.config.get("ALLOW_SIMULATED_BIOMETRICS", False)
    else:
        min_bright = 45.0
        max_bright = 235.0
        min_sharp = 35.0
        allow_sim = False

    # Client-supplied quality metrics are only trusted in simulation mode; otherwise
    # quality is always measured from the captured image itself.
    quality_override = (capture_payload.get("quality_metrics") or {}) if allow_sim else {}
    brightness = float(quality_override.get("brightness", 128.0))
    sharpness = float(quality_override.get("sharpness", 85.0))
    face_detected = bool(quality_override.get("face_detected", True))
    obstructed = bool(quality_override.get("obstructed", False))

    embedding = None
    img_quality = {}

    # 1. Decode base64 image if provided with comprehensive content validation
    image_b64 = capture_payload.get("image_base64")
    if image_b64 and isinstance(image_b64, str):
        if len(image_b64) < 64:
            return {
                "usable": False,
                "rejection_code": "INVALID_IMAGE_DATA",
                "rejection_message": "Image payload is too small to be a valid file.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }
        if len(image_b64) > 10 * 1024 * 1024:
            return {
                "usable": False,
                "rejection_code": "PAYLOAD_TOO_LARGE",
                "rejection_message": "Image payload exceeds 10MB limit.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }
        try:
            raw_b64 = image_b64.split(",", 1)[-1].strip()
            img_bytes = base64.b64decode(raw_b64)
        except Exception:
            return {
                "usable": False,
                "rejection_code": "INVALID_IMAGE_DATA",
                "rejection_message": "Captured frame could not be base64-decoded. Please retry scan.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

        # Content validation: magic bytes check (JPEG, PNG, WebP)
        is_jpeg = img_bytes[:3] == b"\xff\xd8\xff"
        is_png = img_bytes[:8] == b"\x89PNG\r\n\x1a\n"
        is_webp = img_bytes[:4] == b"RIFF" and b"WEBP" in img_bytes[:16]
        if not (is_jpeg or is_png or is_webp):
            return {
                "usable": False,
                "rejection_code": "INVALID_IMAGE_FORMAT",
                "rejection_message": "Image payload does not match JPEG, PNG, or WebP binary magic bytes.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

        try:
            # Verify structure then load pixel data
            v_img = Image.open(io.BytesIO(img_bytes))
            v_img.verify()
            img = Image.open(io.BytesIO(img_bytes))
            img.load()
        except Exception as ex:
            return {
                "usable": False,
                "rejection_code": "CORRUPT_IMAGE_DATA",
                "rejection_message": f"Image file is corrupt and cannot be parsed: {ex}",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

        if img.width < 64 or img.height < 64:
            return {
                "usable": False,
                "rejection_code": "IMAGE_TOO_SMALL",
                "rejection_message": f"Image resolution ({img.width}x{img.height}) is below minimum 64x64.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }
        if img.width > 4096 or img.height > 4096:
            return {
                "usable": False,
                "rejection_code": "IMAGE_TOO_LARGE",
                "rejection_message": f"Image resolution ({img.width}x{img.height}) exceeds maximum 4096x4096.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

        # Check for blank / solid color image
        arr_test = np.asarray(img.convert("L"), dtype=np.float64)
        if float(np.var(arr_test)) < 1.0:
            return {
                "usable": False,
                "rejection_code": "BLANK_OR_EMPTY_IMAGE",
                "rejection_message": "Image is blank, empty, or a single solid color.",
                "quality_score": 0.0,
                "quality_details": {},
                "embedding": None,
            }

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
    if "liveness_score" in img_quality:
        quality_details["liveness_score"] = img_quality["liveness_score"]
        quality_details["liveness_passed"] = img_quality["liveness_passed"]

    # 3. Validate quality and biometric integrity rules (AT-03, AT-06, Liveness, Face Counts)
    faces_count = img_quality.get("faces_count", 1)
    if allow_sim and "faces_count" in quality_override:
        faces_count = int(quality_override["faces_count"])
    if allow_sim and "face_detected" in quality_override:
        face_detected = bool(quality_override["face_detected"])

    if faces_count == 0 or not face_detected or obstructed:
        code = "ZERO_FACES_DETECTED" if faces_count == 0 else "FACE_NOT_DETECTED_OR_OBSTRUCTED"
        msg = (
            "No face detected in camera frame. Please position yourself directly in front of the camera."
            if faces_count == 0
            else "No clear, unobstructed face detected in the camera frame. Please remove obstructions, look directly at the camera, and retry."
        )
        return {
            "usable": False,
            "rejection_code": code,
            "rejection_message": msg,
            "quality_score": 0.15,
            "quality_details": quality_details,
            "embedding": None,
        }

    if faces_count > 1:
        return {
            "usable": False,
            "rejection_code": "MULTIPLE_FACES_DETECTED",
            "rejection_message": (
                f"Multiple faces detected ({faces_count} faces in frame). "
                "For biometric security, only one person may scan at a time."
            ),
            "quality_score": 0.20,
            "quality_details": quality_details,
            "embedding": None,
        }

    # Anti-spoofing rejection
    if img_quality.get("spoof_detected") or (img_quality.get("liveness_passed") is False):
        spoof_type = img_quality.get("spoof_type") or "SPOOF_DETECTED"
        return {
            "usable": False,
            "rejection_code": spoof_type,
            "rejection_message": (
                "Anti-spoofing alert: Live face presentation required. "
                "Printed photos, phone displays, and screen replays are rejected."
            ),
            "quality_score": 0.10,
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
    Compare a validated face capture against all ACTIVE enrolled templates
    matching the active FACE_MODEL_NAME and FACE_MODEL_VERSION.
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

    current_model_name = current_app.config.get("FACE_MODEL_NAME", "EIPC-Vision-Embedder")
    current_model_version = current_app.config.get("FACE_MODEL_VERSION", "1.0.0")

    # Model compatibility enforcement: only compare against active templates matching current model
    all_active = FaceTemplate.query.filter_by(status="ACTIVE").all()
    active_templates = [
        t for t in all_active
        if t.model_name == current_model_name and t.model_version == current_model_version
    ]
    incompatible_count = len(all_active) - len(active_templates)
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

