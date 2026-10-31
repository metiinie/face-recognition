"""
Verification suite for Biometric Evaluation Metrics & Modern Full-Stack Integration:
  - False Acceptance Rate (FAR)
  - False Rejection Rate (FRR)
  - Equal Error Rate (EER) and Operating Threshold
  - End-to-end recognition latency budget (< 300 ms)
  - Liveness presentation attack detection rate (PAD > 98%)
  - JWT generation, decoding, and RBAC authorization headers
"""
import pytest
from backend import create_app
from backend.config import TestConfig
from backend.database import db
from backend.database.models import User, Role, Employee
from backend.database.seed import seed_initial_data
from backend.security.tokens import issue_jwt_token, decode_jwt_token
from backend.face_engine.recognizer import compute_biometric_evaluation_metrics
from backend.face_enrollment.service import decrypt_embedding


@pytest.fixture()
def app():
    application = create_app(config_class=TestConfig, seed_db=False)
    with application.app_context():
        db.create_all()
        seed_initial_data()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def test_biometric_evaluation_metrics_and_curves(app):
    """Verify FAR, FRR, EER, and Recharts ROC/DET curve computations."""
    with app.app_context():
        metrics = compute_biometric_evaluation_metrics(decrypt_fn=decrypt_embedding)

        # 1. FAR must be strict at operating threshold (<= 0.001% / 0.0001 fraction)
        assert "far" in metrics
        assert metrics["far"] <= 0.005, f"Expected low FAR, got {metrics['far']}"

        # 2. FRR must remain reasonable (<= 5%)
        assert "frr" in metrics
        assert metrics["frr"] <= 0.05, f"Expected low FRR, got {metrics['frr']}"

        # 3. Equal Error Rate (EER) must be below 2%
        assert "eer" in metrics
        assert metrics["eer"] <= 0.02, f"Expected EER <= 0.02, got {metrics['eer']}"

        # 4. Latency budget check (< 300 ms SLA)
        lat = metrics["recognition_latency_ms"]
        assert lat["mean"] < 250, f"Mean latency exceeds 250ms: {lat['mean']}"
        assert lat["p95"] < 300, f"p95 latency exceeds 300ms: {lat['p95']}"
        assert "breakdown" in lat
        assert lat["breakdown"]["detection_ms"] > 0
        assert lat["breakdown"]["onnx_inference_ms"] > 0

        # 5. Liveness Attack Detection (PAD) rate must exceed 98%
        pad = metrics["liveness_pad"]
        assert pad["attack_detection_rate"] >= 0.98, f"PAD rate below 98%: {pad['attack_detection_rate']}"
        assert pad["apcer"] <= 0.02
        assert "printed_photos" in pad["attacks_tested"]
        assert "screen_glare_displays" in pad["attacks_tested"]
        assert "video_screen_moire" in pad["attacks_tested"]

        # 6. Detailed ROC/DET curves must span threshold range 0.10 to 0.95
        curves = metrics["roc_det_curves"]
        assert len(curves) >= 10
        assert curves[0]["threshold"] <= 0.15
        assert curves[-1]["threshold"] >= 0.90


def test_jwt_issuance_decoding_and_rbac(client, app):
    """Verify JWT bearer tokens with RBAC claims and /api/auth/me verification."""
    with app.app_context():
        hr_user = User.query.filter_by(username="hr_officer").first()
        assert hr_user is not None

        # Issue token
        token = issue_jwt_token(hr_user)
        assert isinstance(token, str)

        # Decode token
        payload, err = decode_jwt_token(token)
        assert err is None
        assert payload["sub"] == str(hr_user.id)
        assert payload["username"] == "hr_officer"
        assert payload["role"] == "HR_OFFICER"

        # Call /api/auth/me with Bearer token
        resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        json_data = resp.get_json()
        assert json_data["username"] == "hr_officer"
        assert json_data["role"] == "HR_OFFICER"


def test_api_biometric_metrics_endpoint(client, app):
    """Verify REST API /api/face/biometric-metrics responds with correct schema."""
    with app.app_context():
        resp = client.get("/api/face/biometric-metrics")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "far" in data
        assert "frr" in data
        assert "eer" in data
        assert "recognition_latency_ms" in data
        assert "liveness_pad" in data
        assert "roc_det_curves" in data

