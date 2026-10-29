"""
Database package initialization and transaction management utilities.
"""
from contextlib import contextmanager
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


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

