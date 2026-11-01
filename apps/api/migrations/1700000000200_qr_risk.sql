-- Up Migration

CREATE TYPE qr_kind AS ENUM ('batch', 'package');
CREATE TYPE qr_status AS ENUM ('active', 'revoked', 'superseded');
CREATE TYPE alert_status AS ENUM ('open', 'investigating', 'resolved', 'dismissed');
CREATE TYPE investigation_status AS ENUM (
  'open', 'under_investigation', 'verification_requested', 'confirmed_suspicious', 'false_positive',
  'escalated_manufacturer', 'escalated_authority', 'resolved'
);
CREATE TYPE job_status AS ENUM ('queued', 'running', 'done', 'failed');

-- ---------- packages and QR identities ----------
CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  serial_no integer NOT NULL CHECK (serial_no > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, serial_no)
);

-- token_enc lets manufacturers re-download labels; lookups use the SHA-256 token_hash only.
CREATE TABLE qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  package_id uuid REFERENCES packages,
  kind qr_kind NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_enc text NOT NULL,
  status qr_status NOT NULL DEFAULT 'active',
  issued_by uuid REFERENCES users,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  supersedes_id uuid REFERENCES qr_codes,
  CHECK ((kind = 'package') = (package_id IS NOT NULL))
);
CREATE UNIQUE INDEX qr_one_active_batch_uidx ON qr_codes (batch_id) WHERE kind = 'batch' AND status = 'active';
CREATE UNIQUE INDEX qr_one_active_package_uidx ON qr_codes (package_id) WHERE status = 'active';
CREATE INDEX qr_codes_batch_idx ON qr_codes (batch_id, issued_at DESC);

-- Public farmers are pseudonymous: only a hash of the device id is stored.
CREATE TABLE public_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_hash text NOT NULL UNIQUE,
  push_token_enc text,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'te', 'hi')),
  region text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_id uuid NOT NULL REFERENCES qr_codes,
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  device_hash text,
  lat numeric(6, 2),                       -- rounded to ~1 km; precise location is never stored
  lon numeric(6, 2),
  result jsonb NOT NULL DEFAULT '{}',
  chain_verified boolean
);
CREATE INDEX qr_scans_qr_idx ON qr_scans (qr_id, scanned_at DESC);
CREATE INDEX qr_scans_batch_idx ON qr_scans (batch_id, scanned_at DESC);

CREATE TABLE counterfeit_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  qr_id uuid REFERENCES qr_codes,
  device_hash text,
  region text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX counterfeit_reports_batch_idx ON counterfeit_reports (batch_id, created_at DESC);

-- Batch ledger-verification state written by the integrity job (never by request handlers).
ALTER TABLE seed_batches ADD COLUMN ledger_status text NOT NULL DEFAULT 'unverified'
  CHECK (ledger_status IN ('unverified', 'verified', 'mismatch'));

-- ---------- risk, alerts, investigations ----------
CREATE TABLE risk_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  weights jsonb NOT NULL DEFAULT '{}',
  thresholds jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version text NOT NULL,
  mode text NOT NULL,
  data_description text,
  metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE anomaly_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  model_version text NOT NULL,
  mode text NOT NULL,
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  level text NOT NULL CHECK (level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  category text NOT NULL,
  severity text NOT NULL,
  confidence numeric(4, 3),
  indicators jsonb NOT NULL DEFAULT '[]',
  evidence jsonb NOT NULL DEFAULT '[]',
  recommended_action text,
  config_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anomaly_predictions_batch_idx ON anomaly_predictions (batch_id, created_at DESC);

CREATE TABLE risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  level text NOT NULL CHECK (level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  components jsonb NOT NULL DEFAULT '{}',
  config_version text,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_scores_batch_idx ON risk_scores (batch_id, computed_at DESC);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  alert_type text NOT NULL,
  severity text NOT NULL,
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  status alert_status NOT NULL DEFAULT 'open',
  dedupe_key text NOT NULL,
  assignee_id uuid REFERENCES users,
  summary text NOT NULL,
  resolution jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open alert per (batch, type): re-detections update it instead of duplicating.
CREATE UNIQUE INDEX alerts_open_dedupe_uidx ON alerts (dedupe_key) WHERE status IN ('open', 'investigating');
CREATE INDEX alerts_tenant_idx ON alerts (tenant_id, detected_at DESC, id);
CREATE INDEX alerts_batch_idx ON alerts (batch_id);

CREATE TABLE investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  alert_id uuid NOT NULL REFERENCES alerts,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  status investigation_status NOT NULL DEFAULT 'open',
  requires_human_review boolean NOT NULL DEFAULT false,
  report jsonb,
  generated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX investigations_alert_uidx ON investigations (alert_id);

CREATE TABLE investigation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES investigations,
  kind text NOT NULL CHECK (kind IN ('observed_fact', 'model_interpretation', 'hypothesis')),
  record_type text,
  record_id text,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE investigation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES investigations,
  action text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER investigation_actions_append_only BEFORE UPDATE OR DELETE ON investigation_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- notifications ----------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants,
  user_id uuid REFERENCES users,
  device_id uuid REFERENCES public_devices,
  type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'sms')),
  dedupe_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key, channel),
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_device_idx ON notifications (device_id, created_at DESC);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'sms')),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type, channel)
);

-- ---------- background jobs (DB-backed, SKIP LOCKED) ----------
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  dedupe_key text,
  status job_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_dedupe_uidx ON jobs (dedupe_key) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE status = 'queued';

-- ---------- row level security ----------
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;        ALTER TABLE packages FORCE ROW LEVEL SECURITY;
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;        ALTER TABLE qr_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE qr_scans ENABLE ROW LEVEL SECURITY;        ALTER TABLE qr_scans FORCE ROW LEVEL SECURITY;
ALTER TABLE counterfeit_reports ENABLE ROW LEVEL SECURITY; ALTER TABLE counterfeit_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE anomaly_predictions ENABLE ROW LEVEL SECURITY; ALTER TABLE anomaly_predictions FORCE ROW LEVEL SECURITY;
ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY;     ALTER TABLE risk_scores FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;          ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;  ALTER TABLE investigations FORCE ROW LEVEL SECURITY;
ALTER TABLE investigation_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE investigation_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE investigation_actions ENABLE ROW LEVEL SECURITY; ALTER TABLE investigation_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;   ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public_devices ENABLE ROW LEVEL SECURITY;  ALTER TABLE public_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;            ALTER TABLE jobs FORCE ROW LEVEL SECURITY;

-- Tenant-owned analytics/QR data: the owning manufacturer tenant reads it; writes go through
-- system context (workers, public endpoints) or the owning tenant for QR management.
CREATE POLICY packages_all ON packages FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY qr_codes_all ON qr_codes FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY qr_scans_select ON qr_scans FOR SELECT USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY qr_scans_insert ON qr_scans FOR INSERT WITH CHECK (app_is_system());
CREATE POLICY reports_select ON counterfeit_reports FOR SELECT USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY reports_insert ON counterfeit_reports FOR INSERT WITH CHECK (app_is_system());
CREATE POLICY predictions_select ON anomaly_predictions FOR SELECT USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY predictions_insert ON anomaly_predictions FOR INSERT WITH CHECK (app_is_system());
CREATE POLICY risk_scores_select ON risk_scores FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR batch_id IN (SELECT id FROM seed_batches));
CREATE POLICY risk_scores_insert ON risk_scores FOR INSERT WITH CHECK (app_is_system());
CREATE POLICY alerts_all ON alerts FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY investigations_all ON investigations FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY evidence_all ON investigation_evidence FOR ALL
  USING (app_is_system() OR investigation_id IN (SELECT id FROM investigations))
  WITH CHECK (app_is_system() OR investigation_id IN (SELECT id FROM investigations));
CREATE POLICY inv_actions_all ON investigation_actions FOR ALL
  USING (app_is_system() OR investigation_id IN (SELECT id FROM investigations))
  WITH CHECK (app_is_system() OR investigation_id IN (SELECT id FROM investigations));
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY notifications_write ON notifications FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY public_devices_system ON public_devices FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());
CREATE POLICY jobs_system ON jobs FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- ---------- grants ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartseed_app') THEN
    GRANT SELECT, INSERT, UPDATE ON packages, qr_codes, alerts, investigations, public_devices, notifications, jobs TO smartseed_app;
    GRANT SELECT, INSERT ON qr_scans, counterfeit_reports, anomaly_predictions, risk_scores, investigation_evidence,
      investigation_actions, model_versions TO smartseed_app;
    GRANT SELECT ON risk_config TO smartseed_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO smartseed_app;
    GRANT UPDATE (ledger_status) ON seed_batches TO smartseed_app;
  END IF;
END $$;

-- ---------- RBAC seed ----------
INSERT INTO permissions (code) VALUES
  ('qr:read'), ('qr:manage'), ('risk:read'), ('alert:read'), ('alert:manage'), ('investigation:read'),
  ('investigation:decide'), ('notification:read'), ('platform:risk:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('platform_admin', 'platform:risk:read'), ('platform_admin', 'investigation:read'), ('platform_admin', 'investigation:decide'),
  ('platform_admin', 'alert:read'), ('platform_admin', 'alert:manage'),
  ('company_admin', 'qr:read'), ('company_admin', 'qr:manage'), ('company_admin', 'risk:read'), ('company_admin', 'alert:read'),
  ('company_admin', 'alert:manage'), ('company_admin', 'investigation:read'), ('company_admin', 'investigation:decide'),
  ('company_admin', 'notification:read'),
  ('manufacturer', 'qr:read'), ('manufacturer', 'qr:manage'), ('manufacturer', 'risk:read'), ('manufacturer', 'alert:read'),
  ('manufacturer', 'notification:read'),
  ('distributor', 'risk:read'), ('distributor', 'notification:read'),
  ('wholesaler', 'risk:read'), ('wholesaler', 'notification:read'),
  ('retailer', 'risk:read'), ('retailer', 'notification:read')
) AS m(role_name, perm) JOIN roles r ON r.name = m.role_name JOIN permissions p ON p.code = m.perm;

-- Down Migration
DROP TABLE IF EXISTS jobs, notification_preferences, notifications, investigation_actions, investigation_evidence,
  investigations, alerts, risk_scores, anomaly_predictions, model_versions, risk_config, counterfeit_reports,
  qr_scans, public_devices, qr_codes, packages CASCADE;
ALTER TABLE seed_batches DROP COLUMN IF EXISTS ledger_status;
DROP TYPE IF EXISTS job_status, investigation_status, alert_status, qr_status, qr_kind;
