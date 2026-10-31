import os, sys
sys.path.insert(0, ".")
from PIL import Image
import numpy as np
from backend.face_engine.recognizer import _extract_embedding_from_pil, cosine_similarity
from backend.face_enrollment.service import decrypt_embedding
from backend.database.models import FaceTemplate
from backend import create_app

app = create_app()
with app.app_context():
    t7 = app.extensions["sqlalchemy"].session.get(FaceTemplate, 7)
    v1 = np.array(decrypt_embedding(t7.template_data))

img = Image.open(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/exact_cam_frame.jpg").convert("RGB")
v2, q = _extract_embedding_from_pil(img)
v2 = np.array(v2)

print("V1 mean:", np.mean(v1), "std:", np.std(v1), "norm:", np.linalg.norm(v1))
print("V2 mean:", np.mean(v2), "std:", np.std(v2), "norm:", np.linalg.norm(v2))
print("Dot product (cosine similarity):", np.dot(v1, v2))

# Let's inspect block by block (16 blocks of 8 bins each)
corrs = []
for i in range(16):
    b1 = v1[i*8:(i+1)*8]
    b2 = v2[i*8:(i+1)*8]
    dp = np.dot(b1, b2) / (np.linalg.norm(b1) * np.linalg.norm(b2) + 1e-6)
    corrs.append(dp)
print("Block similarities (16 blocks):")
print([round(c, 2) for c in corrs])

