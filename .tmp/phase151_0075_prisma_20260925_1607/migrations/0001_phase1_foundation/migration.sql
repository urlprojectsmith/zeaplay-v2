CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS system_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component VARCHAR(120) NOT NULL,
  status VARCHAR(40) NOT NULL,
  checked_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_system_health_component ON system_health (component);
