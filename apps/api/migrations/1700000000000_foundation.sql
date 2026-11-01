-- Up Migration

-- ---------- helpers used by RLS policies ----------
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_is_system() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_system', true), '') = 'on' $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% on % is not permitted (append-only)', TG_OP, TG_TABLE_NAME; END $$;

-- ---------- enums ----------
CREATE TYPE tenant_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

-- ---------- RBAC reference data (global, read-only for the app) ----------
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant', 'organization'))
);
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------- billing reference ----------
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}',
  price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  billing_interval text NOT NULL DEFAULT 'month',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- tenants ----------
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status tenant_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenants_created_idx ON tenants (created_at DESC, id);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  plan_id uuid NOT NULL REFERENCES plans,
  status subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  renews_at timestamptz,
  gateway_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id);

-- ---------- users ----------
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants,           -- NULL for platform admins / auditors
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret_enc text,
  mfa_last_step bigint NOT NULL DEFAULT 0,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uidx ON users (lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id, created_at DESC, id);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  mfa boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ---------- audit log (hash chained, append-only) ----------
CREATE TABLE audit_logs (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid REFERENCES tenants,           -- NULL = platform chain
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  ip text,
  metadata jsonb NOT NULL DEFAULT '{}',
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_seq_idx ON audit_logs (tenant_id, seq DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------- row level security (forced: also applies to the table owner) ----------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;       ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;         ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;    ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;    ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_isolation ON tenants
  USING (app_is_system() OR id = app_current_tenant())
  WITH CHECK (app_is_system());
CREATE POLICY subscriptions_isolation ON subscriptions
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system());
CREATE POLICY users_isolation ON users
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY user_roles_isolation ON user_roles
  USING (app_is_system() OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id));
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (app_is_system() OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens.user_id))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM users u WHERE u.id = refresh_tokens.user_id));
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

-- ---------- grants for the application role (created by infra init script) ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartseed_app') THEN
    GRANT USAGE ON SCHEMA public TO smartseed_app;
    GRANT SELECT ON roles, permissions, role_permissions, plans TO smartseed_app;
    GRANT SELECT, INSERT, UPDATE ON tenants, subscriptions, users TO smartseed_app;
    GRANT SELECT, INSERT, DELETE ON user_roles TO smartseed_app;
    GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO smartseed_app;
    GRANT SELECT, INSERT ON audit_logs TO smartseed_app;
    GRANT USAGE ON SEQUENCE audit_logs_seq_seq TO smartseed_app;
  END IF;
END $$;

-- ---------- seed: roles, permissions, default trial plan ----------
INSERT INTO roles (name, scope) VALUES
  ('platform_admin', 'platform'), ('company_admin', 'tenant'), ('manufacturer', 'tenant'),
  ('distributor', 'organization'), ('wholesaler', 'organization'), ('retailer', 'organization'),
  ('auditor', 'platform');

INSERT INTO permissions (code) VALUES
  ('platform:tenant:read'), ('platform:tenant:write'), ('platform:audit:read'),
  ('user:read'), ('user:write'), ('audit:read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('platform_admin', 'platform:tenant:read'), ('platform_admin', 'platform:tenant:write'),
  ('platform_admin', 'platform:audit:read'),
  ('company_admin', 'user:read'), ('company_admin', 'user:write'), ('company_admin', 'audit:read')
) AS m(role_name, perm) JOIN roles r ON r.name = m.role_name JOIN permissions p ON p.code = m.perm;

-- Pricing is data, not code: operators edit this row (or add plans) via admin tooling.
INSERT INTO plans (code, name, limits, price_minor) VALUES
  ('trial', 'Trial', '{"batches": 50, "users": 5, "scans": 5000}', 0);

-- Down Migration
DROP TABLE IF EXISTS audit_logs, refresh_tokens, user_roles, users, subscriptions, tenants,
  plans, role_permissions, permissions, roles CASCADE;
DROP TYPE IF EXISTS subscription_status, user_status, tenant_status;
DROP FUNCTION IF EXISTS forbid_mutation(), app_is_system(), app_current_tenant();
