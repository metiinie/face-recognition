"""
Authentication, password security, and role-based access control (RBAC) enforcement.
Satisfies Section 4 (auth module) and Acceptance Tests AT-21, AT-22, AT-24, AT-25.
"""
from functools import wraps
from flask import session, request, redirect, url_for, jsonify, abort, g
from werkzeug.security import generate_password_hash, check_password_hash
from backend.database import db
from backend.database.models import User, Role, utc_now
from backend.audit.service import record_audit_log


def hash_password(plain_password: str) -> str:
    """Hash password securely using Werkzeug PBKDF2/Scrypt."""
    return generate_password_hash(plain_password)


def verify_password(password_hash: str, plain_password: str) -> bool:
    """Verify plain password against stored hash."""
    return check_password_hash(password_hash, plain_password)


def authenticate_user(username: str, password: str) -> tuple[User | None, str | None]:
    """
    Validate credentials and update last_login_at.
    Returns (user, error_message).
    """
    if not username or not password:
        return None, "Username and password are required."

    user = User.query.filter_by(username=username.strip()).first()
    if not user or not verify_password(user.password_hash, password):
        record_audit_log(
            action="AUTH_LOGIN_FAILED",
            target_type="USER",
            target_id=username,
            reason="Invalid username or password",
            actor_username=username or "ANONYMOUS",
            commit=True,
        )
        return None, "Invalid username or password."

    if user.status != "ACTIVE":
        record_audit_log(
            action="AUTH_LOGIN_BLOCKED_INACTIVE",
            target_type="USER",
            target_id=user.id,
            reason="Deactivated user attempted login",
            actor_user_id=user.id,
            actor_username=user.username,
            commit=True,
        )
        return None, "User account is deactivated. Contact System Administrator."

    user.last_login_at = utc_now()
    session["user_id"] = user.id
    session["username"] = user.username
    session["role_name"] = user.role.name if user.role else "UNKNOWN"
    session["full_name"] = user.full_name

    record_audit_log(
        action="AUTH_LOGIN_SUCCESS",
        target_type="USER",
        target_id=user.id,
        details={"role": session["role_name"]},
        actor_user_id=user.id,
        actor_username=user.username,
        commit=True,
    )
    return user, None


def get_current_user() -> User | None:
    """
    Retrieve the currently authenticated User from the session.
    Deliberately not cached on `flask.g`: an app context can outlive a single request
    (e.g. under test clients), which would leak a signed-out user into later requests.
    """
    user_id = session.get("user_id")
    if not user_id:
        return None

    user = db.session.get(User, user_id)
    if not user or user.status != "ACTIVE":
        session.clear()
        return None
    return user


def _wants_json() -> bool:
    return (
        request.path.startswith("/api/")
        or request.is_json
        or "application/json" in request.headers.get("Accept", "")
    )


def login_required(f):
    """Enforce authenticated user session (AT-21)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            if _wants_json():
                return jsonify({"error": "Authentication required", "code": "UNAUTHENTICATED"}), 401
            return redirect(url_for("web_ui.login_page", next=request.path))
        return f(*args, **kwargs)
    return decorated


def permission_required(permission: str):
    """Enforce specific permission on the server (AT-21, AT-22, AT-25)."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user = get_current_user()
            if not user:
                if _wants_json():
                    return jsonify({"error": "Authentication required", "code": "UNAUTHENTICATED"}), 401
                return redirect(url_for("web_ui.login_page", next=request.path))
            if not user.has_permission(permission):
                record_audit_log(
                    action="ACCESS_DENIED",
                    target_type="PERMISSION",
                    target_id=permission,
                    reason=f"Role {user.role.name if user.role else 'NONE'} lacks {permission}",
                    actor_user_id=user.id,
                    actor_username=user.username,
                    commit=True,
                )
                if _wants_json():
                    return jsonify({
                        "error": f"Forbidden: requires permission '{permission}'",
                        "code": "FORBIDDEN"
                    }), 403
                abort(403)
            return f(*args, **kwargs)
        return decorated
    return decorator


def admin_required(f):
    """Enforce ADMIN role on the server (AT-22)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            if _wants_json():
                return jsonify({"error": "Authentication required", "code": "UNAUTHENTICATED"}), 401
            return redirect(url_for("web_ui.login_page", next=request.path))
        if not user.role or user.role.name != "ADMIN":
            record_audit_log(
                action="ADMIN_OPERATION_DENIED",
                target_type="ENDPOINT",
                target_id=request.path,
                reason=f"User {user.username} ({user.role.name if user.role else 'NONE'}) attempted ADMIN operation",
                actor_user_id=user.id,
                actor_username=user.username,
                commit=True,
            )
            if _wants_json():
                return jsonify({
                    "error": "Forbidden: Administrator role required",
                    "code": "ADMIN_REQUIRED"
                }), 403
            abort(403)
        return f(*args, **kwargs)
    return decorated

