from backend import create_app
from backend.database.models import FaceTemplate, Employee
from backend.face_enrollment.service import decrypt_embedding
from backend.face_engine.recognizer import cosine_similarity, generate_deterministic_embedding

app = create_app()
with app.app_context():
    t7 = app.extensions['sqlalchemy'].session.get(FaceTemplate, 7)
    vec7 = decrypt_embedding(t7.template_data)
    
    # Check all active templates
    for t in FaceTemplate.query.filter_by(status='ACTIVE').all():
        vec = decrypt_embedding(t.template_data)
        emp = t.employee
        sim = cosine_similarity(vec7, vec)
        print(f"Template #{t.id} ({emp.employee_number} - {emp.full_name}): similarity = {sim:.4f}")

    # Also check deterministic embeddings for seeds
    for seed in ['EIPC-EMP-001', 'EIPC-EMP-007', 'Awol', 'Awol Ibrahim', 'sample_face']:
        det = generate_deterministic_embedding(seed)
        sim = cosine_similarity(vec7, det)
        print(f"Similarity with seed '{seed}': {sim:.4f}")

