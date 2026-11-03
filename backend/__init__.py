"""
Flask Application Factory for the Face Recognition-Based Attendance Management System
Ethio-Italy Polytechnic College, Dire Dawa (Version 1)
"""
import os
from flask import Flask
from backend.config import Config
from backend.database import db


def create_app(config_class=Config, seed_db: bool = True) -> Flask:
    base_dir = os.path.abspath(os.path.dirname(__file__))
    template_dir = os.path.join(base_dir, "web_ui", "templates")
    static_dir = os.path.join(base_dir, "web_ui", "static")

    app = Flask(
        __name__,
        template_folder=template_dir,
        static_folder=static_dir,
    )
    app.config.from_object(config_class)

    # In production, strictly enforce that secure keys are configured
    if app.config.get("ENV") == "production" or os.environ.get("FLASK_ENV") == "production":
        from backend.config import validate_production_secrets
        validate_production_secrets(app.config)

    # Enable CORS for API endpoints so Next.js frontend or mobile kiosks can connect cleanly
    try:
        from flask_cors import CORS
        CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)
    except ImportError:
        pass

    db.init_app(app)

    from backend.security.csrf import check_csrf, generate_csrf_token
    app.before_request(check_csrf)

    @app.context_processor
    def inject_csrf():
        return {"csrf_token": generate_csrf_token}

    from backend.web_ui.routes import web_ui_bp
    from backend.web_ui.api_routes import api_bp

    app.register_blueprint(web_ui_bp)
    app.register_blueprint(api_bp)

    # Initialize WebSocket real-time communication
    try:
        from backend.socketio_service import socketio, register_socket_events
        socketio.init_app(app, cors_allowed_origins="*", async_mode="threading")
        register_socket_events(socketio)
    except Exception as e:
        app.logger.warning(f"Could not initialize SocketIO: {e}")

    with app.app_context():
        import backend.database.models  # noqa: F401
        db.create_all()
        if seed_db and not app.config.get("TESTING", False):
            from backend.database.seed import seed_initial_data
            seed_initial_data()

    return app

