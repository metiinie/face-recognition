"""Web UI and REST API blueprints initialization."""
from backend.web_ui.routes import web_ui_bp
from backend.web_ui.api_routes import api_bp

__all__ = ["web_ui_bp", "api_bp"]

