"""
Tests for native computer vision pipeline, anti-spoofing / liveness detection, and CSRF protection.
"""
import io
import base64
import numpy as np
from PIL import Image
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.seed import seed_initial_data
from backend.face_engine.recognizer import analyze_and_extract_embedding


def _create_synthetic_face_image_b64(skin_color=(210, 160, 130), noise_std=15.0):
    """Generate a synthetic test face image with natural skin tones and gradient texture."""
    img_arr = np.zeros((160, 160, 3), dtype=np.uint8)
    # Background
    img_arr[:, :] = [60, 60, 70]
    # Center face region
    for y in range(35, 125):
        for x in range(45, 115):
            # Elliptical face mask
            if ((x - 80) / 32) ** 2 + ((y - 80) / 42) ** 2 <= 1.0:
                noise = np.random.normal(0, noise_std, 3)
                pixel = np.clip(np.array(skin_color) + noise, 0, 255)
                img_arr[y, x] = pixel.astype(np.uint8)

    img = Image.fromarray(img_arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


@pytest.fixture()
def client():
    app = create_app(config_class=TestConfig, seed_db=False)
    with app.app_context():
        db.create_all()
        seed_initial_data()
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def test_vision_pipeline_extracts_embedding_and_passes_liveness(client):
    """Verify that a valid face frame produces a 128-D embedding and passes liveness."""
    b64_face = _create_synthetic_face_image_b64()
    result = analyze_and_extract_embedding({"image_base64": b64_face})
    assert result["usable"] is True
    assert result["embedding"] is not None
    assert len(result["embedding"]) == 128
    assert result["quality_details"]["liveness_passed"] is True
    assert result["quality_details"]["liveness_score"] >= 0.30


def test_csrf_protection_blocks_unauthorized_post_when_enabled(client):
    """Verify CSRF middleware enforces tokens on state-changing HTML form requests."""
    # Temporarily activate strict CSRF verification in test mode
    client.application.config["CSRF_ENABLED_IN_TEST"] = True
    try:
        # POST without token must be blocked (400 Bad Request)
        resp_no_token = client.post(
            "/login",
            data={"username": "admin", "password": "Admin@EIPC2026"},
        )
        assert resp_no_token.status_code == 400

        # Obtain valid CSRF token from session
        with client.session_transaction() as sess:
            sess["_csrf_token"] = "valid-test-csrf-token-12345"

        # POST with matching token succeeds
        resp_with_token = client.post(
            "/login",
            data={
                "username": "admin",
                "password": "Admin@EIPC2026",
                "csrf_token": "valid-test-csrf-token-12345",
            },
        )
        assert resp_with_token.status_code in {200, 302}
    finally:
        client.application.config["CSRF_ENABLED_IN_TEST"] = False
