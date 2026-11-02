import os, sys
sys.path.insert(0, ".")
from backend.face_engine.recognizer import recognize_face_candidate, generate_deterministic_embedding
from backend.face_enrollment.service import decrypt_embedding
from backend import create_app

app = create_app()
with app.app_context():
    # Test stranger
    result = recognize_face_candidate(
        {"biometric_signature": "UNKNOWN_VISITOR_999"},
        decrypt_fn=decrypt_embedding
    )
    print("Stranger result matched:", result["matched"], "status:", result["status"], "score:", result.get("recognition_score"))

