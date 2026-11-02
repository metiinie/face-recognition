import os

file_path = os.path.join("backend", "face_engine", "recognizer.py")
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add SFace session caching and extraction helper
sface_defs = """
_SFACE_SESSION = None
_SFACE_INIT_FAILED = False


def _get_sface_session():
    \"\"\"Lazily load and cache SFace ONNX neural embedding model session.\"\"\"
    global _SFACE_SESSION, _SFACE_INIT_FAILED
    if _SFACE_INIT_FAILED:
        return None
    if _SFACE_SESSION is None:
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(base_dir, "models", "face_recognition_sface_2021dec.onnx")
            if os.path.exists(model_path):
                if cv2 is not None and hasattr(cv2, "FaceRecognizerSF"):
                    _SFACE_SESSION = cv2.FaceRecognizerSF.create(model_path, "")
                elif onnxruntime is not None:
                    opts = onnxruntime.SessionOptions()
                    opts.log_severity_level = 3
                    _SFACE_SESSION = onnxruntime.InferenceSession(model_path, opts)
            else:
                _SFACE_INIT_FAILED = True
        except Exception:
            _SFACE_INIT_FAILED = True
    return _SFACE_SESSION


def extract_neural_embedding(face_pil: Image.Image) -> list[float] | None:
    \"\"\"
    Extract a normalized 128-D neural face embedding using SFace deep neural network.
    Accepts cropped/aligned facial image (PIL Image), normalizes to 112x112 canonical
    biometric space, and returns L2-normalized float vector.
    \"\"\"
    rec = _get_sface_session()
    if rec is None:
        return None
    try:
        if hasattr(rec, "feature"):
            rgb_arr = np.asarray(face_pil.convert("RGB"), dtype=np.uint8)
            bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR) if cv2 is not None else rgb_arr[:, :, ::-1]
            bgr_112 = cv2.resize(bgr_arr, (112, 112), interpolation=cv2.INTER_LINEAR) if cv2 is not None else np.asarray(Image.fromarray(bgr_arr).resize((112, 112)))
            feat = rec.feature(bgr_112)[0]
        else:
            rgb_arr = np.asarray(face_pil.convert("RGB").resize((112, 112)), dtype=np.float32)
            bgr_arr = rgb_arr[:, :, ::-1]
            chw = np.transpose(bgr_arr, (2, 0, 1))
            batch = np.expand_dims(chw, axis=0)
            outs = rec.run(None, {"data": batch})
            feat = outs[0][0]

        norm = float(np.linalg.norm(feat))
        if norm > 0:
            feat = feat / norm
        return [round(float(x), 6) for x in feat]
    except Exception:
        return None
"""

onnx_session_end = "    return _ONNX_SESSION\n"
if onnx_session_end not in content:
    onnx_session_end = "    return _ONNX_SESSION\r\n"

idx_onnx = content.find(onnx_session_end)
assert idx_onnx != -1, "Target _ONNX_SESSION return not found"
insert_pos = idx_onnx + len(onnx_session_end)

if "_get_sface_session" not in content:
    content = content[:insert_pos] + sface_defs + content[insert_pos:]

# 2. Upgrade _extract_embedding_from_pil to attempt neural embedding first
old_grad = """    # Extract 128-D spatial gradient orientation descriptor (16 cells x 8 bins)
    gx = np.diff(gray, axis=1)
    gy = np.diff(gray, axis=0)"""
new_grad = """    # 1. Primary: Extract 128-D SFace deep neural embedding
    neural_emb = extract_neural_embedding(aligned_pil)
    if neural_emb is not None:
        embedding = neural_emb
    else:
        # Fallback: Extract 128-D spatial gradient orientation descriptor (16 cells x 8 bins)
        gx = np.diff(gray, axis=1)
        gy = np.diff(gray, axis=0)"""

if old_grad in content:
    content = content.replace(old_grad, new_grad, 1)

# Indent the remainder of gradient fallback calculation
old_grad_block = """    vec = np.asarray(descriptor_128, dtype=np.float64)
    vec = vec - np.mean(vec)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    embedding = [round(float(val), 6) for val in vec]

    quality = {"""

new_grad_block = """        vec = np.asarray(descriptor_128, dtype=np.float64)
        vec = vec - np.mean(vec)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        embedding = [round(float(val), 6) for val in vec]

    quality = {"""

# Also need to indent the loop lines if neural_emb was inserted
old_loop = """    gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
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
            descriptor_128.extend(hist.tolist())"""

new_loop = """        gx = np.pad(gx, ((0, 0), (0, 1)), mode="edge")[16:144, 16:144]
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
                descriptor_128.extend(hist.tolist())"""

if old_loop in content:
    content = content.replace(old_loop, new_loop, 1)

if old_grad_block in content:
    content = content.replace(old_grad_block, new_grad_block, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Updated recognizer.py successfully.")
