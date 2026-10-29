"""
CSRF Protection module for Flask application HTML forms.
Implements cryptographically signed, session-bound CSRF tokens.
"""
import hmac
import secrets
from flask import session, request, abort, current_app


def generate_csrf_token() -> str:
    """Generate or retrieve the active CSRF token for the current session."""
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_hex(32)
    return session["_csrf_token"]


def validate_csrf_token(token: str | None) -> bool:
    """Validate a submitted CSRF token against the session token."""
    expected = session.get("_csrf_token")
    if not expected or not token:
        return False
    return hmac.compare_digest(expected, token)


def check_csrf():
    """
    Before-request hook verifying CSRF token on POST requests to HTML routes.
    API endpoints (/api/*) are authenticated via station tokens, recognition tokens,
    or Bearer/session checks.
    """
    if current_app.config.get("TESTING", False) and not current_app.config.get("CSRF_ENABLED_IN_TEST", False):
        return

    if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
        if request.path.startswith("/api/"):
            return  # Handled by API auth / station verification
        token = request.form.get("csrf_token") or request.headers.get("X-CSRFToken")
        if not validate_csrf_token(token):
            current_app.logger.warning(
                f"CSRF validation failed for {request.remote_addr} on {request.path}"
            )
            abort(400, description="CSRF token validation failed. Please refresh and try again.")
