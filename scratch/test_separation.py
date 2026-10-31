import os, sys
sys.path.insert(0, ".")
from PIL import Image
import numpy as np
from backend.face_engine.recognizer import cosine_similarity
from backend.face_enrollment.service import decrypt_embedding
from backend.database.models import FaceTemplate
from backend import create_app

app = create_app()
with app.app_context():
    templates = FaceTemplate.query.filter_by(status="ACTIVE").all()
    print(f"Total active templates: {len(templates)}")
    for i, t1 in enumerate(templates):
        v1 = decrypt_embedding(t1.template_data)
        emp1 = t1.employee
        for t2 in templates[i+1:]:
            v2 = decrypt_embedding(t2.template_data)
            emp2 = t2.employee
            sim = cosine_similarity(v1, v2)
            print(f"Different persons: {emp1.employee_number} vs {emp2.employee_number}: similarity = {sim:.4f}")

