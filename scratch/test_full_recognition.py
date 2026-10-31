import os, sys
sys.path.insert(0, ".")
from PIL import Image
from backend.face_engine.recognizer import recognize_face_candidate
from backend.face_enrollment.service import decrypt_embedding
from backend import create_app
import base64

app = create_app()
with app.app_context():
    with open(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/exact_cam_frame.jpg", "rb") as f:
        b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("utf-8")
    
    result = recognize_face_candidate(
        {"image_base64": b64},
        decrypt_fn=decrypt_embedding
    )
    print("Match result:", result["matched"])
    print("Status:", result["status"])
    if result["matched"]:
        print("Recognized Employee:", result["employee"].employee_number, result["employee"].full_name)
        print("Score:", result["recognition_score"])
    else:
        print("Rejection code:", result.get("rejection_code"))
        print("Rejection message:", result.get("message"))
        print("Score:", result.get("recognition_score"))

