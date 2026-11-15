"""
Database package initialization and transaction management utilities.
"""
from contextlib import contextmanager
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event, inspect, text
from sqlalchemy.engine import Engine

db = SQLAlchemy()


@event.listens_for(Engine, "connect")
def _configure_sqlite_pragmas(dbapi_connection, connection_record):
    """Enable WAL mode and busy_timeout for file-backed SQLite connections to prevent lock errors."""
    module_name = getattr(type(dbapi_connection), "__module__", "")
    if "sqlite3" not in module_name:
        return
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout = 15000")
        db_list = cursor.execute("PRAGMA database_list").fetchall()
        is_file_db = any(len(row) >= 3 and row[1] == "main" and bool(row[2]) for row in db_list)
        if is_file_db:
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.close()
    except Exception:
        pass


def ensure_schema_columns() -> None:
    """
    Safely add newer university governance columns to existing databases
    (e.g., backend/eipc_attendance.db) without requiring manual table drops.
    """
    try:
        inspector = inspect(db.engine)
        table_names = set(inspector.get_table_names())

        with db.engine.begin() as conn:
            if "departments" in table_names:
                dept_cols = {c["name"] for c in inspector.get_columns("departments")}
                if "faculty_name" not in dept_cols:
                    conn.execute(
                        text(
                            "ALTER TABLE departments ADD COLUMN faculty_name VARCHAR(140) DEFAULT 'Ethio-Italy Polytechnic College'"
                        )
                    )
                if "unit_type" not in dept_cols:
                    conn.execute(
                        text(
                            "ALTER TABLE departments ADD COLUMN unit_type VARCHAR(40) NOT NULL DEFAULT 'TECHNICAL_DEPT'"
                        )
                    )

            if "users" in table_names:
                user_cols = {c["name"] for c in inspector.get_columns("users")}
                if "department_id" not in user_cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN department_id INTEGER"))
    except Exception:
        # Fallback cleanly during transient or empty metadata states
        pass


@contextmanager
def transactional_session():
    """
    Context manager providing atomic database transactions with automatic rollback on failure.
    Satisfies AT-13 (Database failure rolls back incomplete transactions without false success).
    """
    try:
        yield db.session
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

