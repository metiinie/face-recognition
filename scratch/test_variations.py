import os, sys
sys.path.insert(0, ".")
from PIL import Image, ImageEnhance
import numpy as np
from backend.face_engine.recognizer import _extract_embedding_from_pil, cosine_similarity
from backend.face_enrollment.service import decrypt_embedding
from backend.database.models import FaceTemplate
from backend import create_app

app = create_app()
with app.app_context():
    t7 = app.extensions["sqlalchemy"].session.get(FaceTemplate, 7)
    v_enrolled = decrypt_embedding(t7.template_data)

base_img = Image.open(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/exact_cam_frame.jpg").convert("RGB")

print("--- Testing natural camera variations ---")
# 1. Base frame
emb_base, q = _extract_embedding_from_pil(base_img)
sim_base = cosine_similarity(emb_base, v_enrolled)
print(f"Base frame: sim = {sim_base:.4f}")

# 2. Brightness +20%
brighter = ImageEnhance.Brightness(base_img).enhance(1.2)
emb_br, _ = _extract_embedding_from_pil(brighter)
print(f"Brightness +20%: sim = {cosine_similarity(emb_br, v_enrolled):.4f}")

# 3. Brightness -20%
darker = ImageEnhance.Brightness(base_img).enhance(0.8)
emb_dk, _ = _extract_embedding_from_pil(darker)
print(f"Brightness -20%: sim = {cosine_similarity(emb_dk, v_enrolled):.4f}")

# 4. Slight zoom in (user 5% closer)
w, h = base_img.size
crop_closer = base_img.crop((int(w*0.03), int(h*0.03), int(w*0.97), int(h*0.97))).resize((w, h))
emb_cl, _ = _extract_embedding_from_pil(crop_closer)
print(f"User 5% closer: sim = {cosine_similarity(emb_cl, v_enrolled):.4f}")

# 5. Slight shift left (user moved 15px left)
shifted_l = Image.new("RGB", (w, h), (30, 30, 30))
shifted_l.paste(base_img.crop((15, 0, w, h)), (0, 0))
emb_sl, _ = _extract_embedding_from_pil(shifted_l)
print(f"Shifted 15px left: sim = {cosine_similarity(emb_sl, v_enrolled):.4f}")

# 6. Slight shift down
shifted_d = Image.new("RGB", (w, h), (30, 30, 30))
shifted_d.paste(base_img.crop((0, 0, w, h - 15)), (0, 15))
emb_sd, _ = _extract_embedding_from_pil(shifted_d)
print(f"Shifted 15px down: sim = {cosine_similarity(emb_sd, v_enrolled):.4f}")

