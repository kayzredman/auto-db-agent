CREATE TABLE IF NOT EXISTS backup_history (
    id BIGSERIAL PRIMARY KEY,
    backup_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    size_mb NUMERIC(14,2),
    source_system VARCHAR(100),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_started_at
    ON backup_history (started_at DESC);

CREATE TABLE IF NOT EXISTS tablespace_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_time TIMESTAMPTZ NOT NULL,
    database_name VARCHAR(100) NOT NULL,
    tablespace_name VARCHAR(150) NOT NULL,
    used_mb NUMERIC(14,2) NOT NULL,
    free_mb NUMERIC(14,2),
    total_mb NUMERIC(14,2),
    usage_percent NUMERIC(5,2),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tablespace_snapshots_time
    ON tablespace_snapshots (snapshot_time DESC);

CREATE TABLE IF NOT EXISTS fra_growth_history (
    id BIGSERIAL PRIMARY KEY,
    snapshot_time TIMESTAMPTZ NOT NULL,
    used_mb NUMERIC(14,2) NOT NULL,
    reclaimable_mb NUMERIC(14,2),
    limit_mb NUMERIC(14,2),
    usage_percent NUMERIC(5,2),
    growth_rate_mb_per_hour NUMERIC(14,2),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fra_growth_history_time
    ON fra_growth_history (snapshot_time DESC);

CREATE TABLE IF NOT EXISTS health_check_results (
    id BIGSERIAL PRIMARY KEY,
    check_time TIMESTAMPTZ NOT NULL,
    component VARCHAR(100) NOT NULL,
    check_name VARCHAR(150) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message TEXT,
    metric_value NUMERIC(18,4),
    threshold_value NUMERIC(18,4),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_check_results_time
    ON health_check_results (check_time DESC);

CREATE INDEX IF NOT EXISTS idx_health_check_results_status
    ON health_check_results (status);

CREATE TABLE IF NOT EXISTS action_logs (
    id BIGSERIAL PRIMARY KEY,
    action_time TIMESTAMPTZ NOT NULL,
    action_type VARCHAR(80) NOT NULL,
    actor VARCHAR(100),
    target VARCHAR(150),
    outcome VARCHAR(20) NOT NULL,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_logs_time
    ON action_logs (action_time DESC);

CREATE INDEX IF NOT EXISTS idx_action_logs_outcome
    ON action_logs (outcome);

-- ============================================
-- DATABASE INVENTORY & ONBOARDING
-- ============================================

CREATE TYPE db_type AS ENUM ('postgres', 'mysql', 'mssql', 'oracle');
CREATE TYPE env_type AS ENUM ('production', 'staging', 'development', 'dr');
CREATE TYPE instance_status AS ENUM ('pending', 'active', 'inactive', 'failed');

CREATE TABLE IF NOT EXISTS environments (
    id SERIAL PRIMARY KEY,
    name env_type NOT NULL UNIQUE,
    display_name VARCHAR(50) NOT NULL,
    description TEXT,
    is_protected BOOLEAN NOT NULL DEFAULT false,
    allowed_roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO environments (name, display_name, description, is_protected, allowed_roles) VALUES
    ('production', 'Production', 'Production databases - restricted access', true, ARRAY['dba_admin', 'dba_senior']),
    ('staging', 'Staging', 'Pre-production testing environment', false, ARRAY['dba_admin', 'dba_senior', 'dba_junior']),
    ('development', 'Development', 'Development and testing databases', false, ARRAY['dba_admin', 'dba_senior', 'dba_junior', 'developer']),
    ('dr', 'Disaster Recovery', 'DR site databases', true, ARRAY['dba_admin'])
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS database_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(150),
    db_type db_type NOT NULL,
    environment env_type NOT NULL,
    
    -- Connection details
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    database_name VARCHAR(150) NOT NULL,
    
    -- Encrypted credentials (AES-256-GCM)
    credentials_encrypted BYTEA NOT NULL,
    credentials_iv BYTEA NOT NULL,
    credentials_tag BYTEA NOT NULL,
    
    -- Metadata
    application VARCHAR(100),
    team VARCHAR(100),
    owner_email VARCHAR(255),
    tags JSONB DEFAULT '{}',
    description TEXT,
    
    -- Pool settings
    pool_min INTEGER DEFAULT 1,
    pool_max INTEGER DEFAULT 10,
    connection_timeout_ms INTEGER DEFAULT 30000,
    idle_timeout_ms INTEGER DEFAULT 600000,
    
    -- Status tracking
    status instance_status NOT NULL DEFAULT 'pending',
    last_health_check TIMESTAMPTZ,
    last_health_status VARCHAR(20),
    consecutive_failures INTEGER DEFAULT 0,
    
    -- Audit
    onboarded_by VARCHAR(100) NOT NULL,
    onboarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    
    CONSTRAINT unique_instance_name_env UNIQUE (name, environment)
);

CREATE INDEX IF NOT EXISTS idx_db_instances_type
    ON database_instances (db_type);

CREATE INDEX IF NOT EXISTS idx_db_instances_env
    ON database_instances (environment);

CREATE INDEX IF NOT EXISTS idx_db_instances_status
    ON database_instances (status);

CREATE INDEX IF NOT EXISTS idx_db_instances_app_team
    ON database_instances (application, team);

CREATE TABLE IF NOT EXISTS onboarding_audit (
    id BIGSERIAL PRIMARY KEY,
    instance_id UUID REFERENCES database_instances(id) ON DELETE SET NULL,
    instance_name VARCHAR(100) NOT NULL,
    action VARCHAR(30) NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    previous_state JSONB,
    new_state JSONB,
    ip_address INET,
    user_agent TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_onboarding_audit_instance
    ON onboarding_audit (instance_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_audit_time
    ON onboarding_audit (performed_at DESC);

-- ─── Tablespace Growth Snapshots (for Prediction Engine) ─────────────────────
-- Stores daily tablespace size snapshots per instance for linear-regression
-- growth predictions. Populated by TablespacePredictionEngine.recordSnapshot().

CREATE TABLE IF NOT EXISTS ts_growth_snapshots (
    id BIGSERIAL PRIMARY KEY,
    instance_id UUID NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
    tablespace_name VARCHAR(200) NOT NULL,
    used_bytes BIGINT NOT NULL,
    total_bytes BIGINT NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ts_growth_snapshot UNIQUE (instance_id, tablespace_name, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_ts_growth_snapshots_lookup
    ON ts_growth_snapshots (instance_id, tablespace_name, snapshot_date DESC);

-- ─── FRA / Recovery Area Snapshots (for FRA Risk Engine) ─────────────────────
-- Stores daily recovery-area usage snapshots per instance for trending and
-- risk analysis. Populated by FRARiskEngine.recordSnapshot().

CREATE TABLE IF NOT EXISTS fra_snapshots (
    id BIGSERIAL PRIMARY KEY,
    instance_id UUID NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
    area_name VARCHAR(200) NOT NULL,
    used_bytes BIGINT NOT NULL,
    total_bytes BIGINT NOT NULL,
    reclaimable_bytes BIGINT NOT NULL DEFAULT 0,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fra_snapshot UNIQUE (instance_id, area_name, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_fra_snapshots_lookup
    ON fra_snapshots (instance_id, area_name, snapshot_date DESC);
