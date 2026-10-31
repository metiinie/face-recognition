import os, sys
sys.path.insert(0, ".")
from PIL import Image
import numpy as np

img = Image.open(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/.user_uploaded/media_1793480901801_12a965b3.png").convert("RGB")
w, h = img.size

# The video feed on screen in the screenshot:
# Notice in the screenshot: The video box is roughly between x=40 and x=565, and y=240 and y=630
# Let's inspect where the black/video rectangle is:
arr = np.asarray(img)
# Find the video rectangle inside the screenshot
# The video has a green circle, white earphone cord, etc.
# Let's crop just the video area:
# x: 42 to 568 (width ~526), y: 236 to 630 (height ~394)
vid_crop = img.crop((44, 238, 566, 630))
vid_crop.save(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/exact_cam_frame.jpg")
print("Saved exact_cam_frame.jpg:", vid_crop.size)

from backend.face_engine.recognizer import _extract_embedding_from_pil, cosine_similarity
from backend.face_enrollment.service import decrypt_embedding
from backend.database.models import FaceTemplate
from backend import create_app

emb, quality = _extract_embedding_from_pil(vid_crop)
print("Quality:", quality)

app = create_app()
with app.app_context():
    t7 = app.extensions["sqlalchemy"].session.get(FaceTemplate, 7)
    vec7 = decrypt_embedding(t7.template_data)
    sim = cosine_similarity(emb, vec7)
    print(f"Cosine similarity with enrolled Template #7: {sim:.4f}")

