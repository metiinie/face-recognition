"""Initial baseline schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('permissions_csv', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_table(
        'departments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('code', sa.String(length=30), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
        sa.UniqueConstraint('name')
    )
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=80), nullable=False),
        sa.Column('full_name', sa.String(length=120), nullable=False),
        sa.Column('email', sa.String(length=120), nullable=True),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'),
        sa.UniqueConstraint('email')
    )
    op.create_table(
        'employees',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_number', sa.String(length=40), nullable=False),
        sa.Column('first_name', sa.String(length=80), nullable=False),
        sa.Column('last_name', sa.String(length=80), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('job_category', sa.String(length=40), nullable=False, server_default='REGULAR_STAFF'),
        sa.Column('phone', sa.String(length=40), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('consent_verified', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_number')
    )
    op.create_table(
        'face_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('template_data', sa.Text(), nullable=False),
        sa.Column('model_name', sa.String(length=80), nullable=False),
        sa.Column('model_version', sa.String(length=40), nullable=False),
        sa.Column('quality_score', sa.Float(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('enrolled_by', sa.String(length=80), nullable=True),
        sa.Column('enrolled_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('revoke_reason', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'attendance_stations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('station_code', sa.String(length=40), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('location', sa.String(length=160), nullable=False),
        sa.Column('station_secret_token', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('camera_status', sa.String(length=30), nullable=False, server_default='ONLINE'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('station_code')
    )
    op.create_table(
        'shift_templates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('job_category', sa.String(length=40), nullable=False, server_default='REGULAR_STAFF'),
        sa.Column('start_time', sa.String(length=5), nullable=False),
        sa.Column('end_time', sa.String(length=5), nullable=False),
        sa.Column('spans_midnight', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('is_24_hour', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('break_rules', sa.String(length=255), nullable=True),
        sa.Column('grace_period_minutes', sa.Integer(), nullable=False, server_default='15'),
        sa.Column('early_checkin_window_minutes', sa.Integer(), nullable=False, server_default='90'),
        sa.Column('hr_approved', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_table(
        'shift_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('shift_template_id', sa.Integer(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('effective_to', sa.Date(), nullable=True),
        sa.Column('working_days', sa.String(length=40), nullable=False, server_default='0,1,2,3,4'),
        sa.Column('approved_by', sa.String(length=80), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['shift_template_id'], ['shift_templates.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'schedule_exceptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('exception_type', sa.String(length=30), nullable=False, server_default='PUBLIC_HOLIDAY'),
        sa.Column('employee_id', sa.Integer(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('approved_by', sa.String(length=80), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'attendance_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('shift_assignment_id', sa.Integer(), nullable=True),
        sa.Column('work_date', sa.Date(), nullable=False),
        sa.Column('shift_start_at', sa.DateTime(), nullable=False),
        sa.Column('shift_end_at', sa.DateTime(), nullable=False),
        sa.Column('check_in_event_id', sa.Integer(), nullable=True),
        sa.Column('check_out_event_id', sa.Integer(), nullable=True),
        sa.Column('arrival_status', sa.String(length=20), nullable=False, server_default='ON_TIME'),
        sa.Column('late_minutes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='OPEN'),
        sa.Column('is_corrected', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('notes', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['shift_assignment_id'], ['shift_assignments.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'attendance_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=20), nullable=False),
        sa.Column('occurred_at', sa.DateTime(), nullable=False),
        sa.Column('station_id', sa.Integer(), nullable=True),
        sa.Column('capture_method', sa.String(length=20), nullable=False, server_default='BIOMETRIC'),
        sa.Column('recognition_score', sa.Float(), nullable=True),
        sa.Column('recorded_by_user_id', sa.Integer(), nullable=True),
        sa.Column('manual_reason', sa.String(length=255), nullable=True),
        sa.Column('evidence_ref', sa.String(length=120), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['recorded_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['session_id'], ['attendance_sessions.id']),
        sa.ForeignKeyConstraint(['station_id'], ['attendance_stations.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'review_cases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('station_id', sa.Integer(), nullable=True),
        sa.Column('candidate_employee_id', sa.Integer(), nullable=True),
        sa.Column('claimed_employee_number', sa.String(length=40), nullable=True),
        sa.Column('case_type', sa.String(length=40), nullable=False, server_default='UNKNOWN_FACE'),
        sa.Column('intended_action', sa.String(length=20), nullable=True),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('recognition_score', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='OPEN'),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        sa.Column('evidence_reference', sa.String(length=120), nullable=True),
        sa.Column('resolved_by_user_id', sa.Integer(), nullable=True),
        sa.Column('resolved_event_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['candidate_employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['resolved_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['resolved_event_id'], ['attendance_events.id']),
        sa.ForeignKeyConstraint(['station_id'], ['attendance_stations.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'attendance_corrections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('original_event_id', sa.Integer(), nullable=True),
        sa.Column('replacement_event_id', sa.Integer(), nullable=True),
        sa.Column('correction_type', sa.String(length=40), nullable=False),
        sa.Column('previous_timestamp', sa.DateTime(), nullable=True),
        sa.Column('corrected_timestamp', sa.DateTime(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('evidence_ref', sa.String(length=120), nullable=True),
        sa.Column('corrected_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['corrected_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['original_event_id'], ['attendance_events.id']),
        sa.ForeignKeyConstraint(['replacement_event_id'], ['attendance_events.id']),
        sa.ForeignKeyConstraint(['session_id'], ['attendance_sessions.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('actor_user_id', sa.Integer(), nullable=True),
        sa.Column('actor_username', sa.String(length=80), nullable=False),
        sa.Column('action', sa.String(length=80), nullable=False),
        sa.Column('target_type', sa.String(length=60), nullable=False),
        sa.Column('target_id', sa.String(length=60), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('details_json', sa.Text(), nullable=True),
        sa.Column('station_id', sa.Integer(), nullable=True),
        sa.Column('ip_address', sa.String(length=60), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'policy_signoffs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('policy_code', sa.String(length=50), nullable=False),
        sa.Column('title', sa.String(length=140), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='PENDING_CONFIRMATION'),
        sa.Column('decision_notes', sa.Text(), nullable=True),
        sa.Column('confirmed_by', sa.String(length=80), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('policy_code')
    )


def downgrade() -> None:
    op.drop_table('policy_signoffs')
    op.drop_table('audit_logs')
    op.drop_table('attendance_corrections')
    op.drop_table('review_cases')
    op.drop_table('attendance_events')
    op.drop_table('attendance_sessions')
    op.drop_table('schedule_exceptions')
    op.drop_table('shift_assignments')
    op.drop_table('shift_templates')
    op.drop_table('attendance_stations')
    op.drop_table('face_templates')
    op.drop_table('employees')
    op.drop_table('users')
    op.drop_table('departments')
    op.drop_table('roles')
