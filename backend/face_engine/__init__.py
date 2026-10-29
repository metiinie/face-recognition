"""Face recognition engine module."""
from backend.face_engine.recognizer import (
    analyze_and_extract_embedding,
    recognize_face_candidate,
    generate_deterministic_embedding,
    cosine_similarity,
)

__all__ = [
    "analyze_and_extract_embedding",
    "recognize_face_candidate",
    "generate_deterministic_embedding",
    "cosine_similarity",
]

