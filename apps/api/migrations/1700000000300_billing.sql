-- Up Migration

ALTER TABLE plans ADD COLUMN gateway_plan_id text;

CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'failed', 'void');

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  subscription_id uuid REFERENCES subscriptions,
  number text NOT NULL UNIQUE,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  status invoice_status NOT NULL DEFAULT 'open',
  period_start date,
  period_end date,
  gateway_ref text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX invoices_tenant_idx ON invoices (tenant_id, issued_at DESC);
CREATE UNIQUE INDEX invoices_gateway_ref_uidx ON invoices (gateway_ref) WHERE gateway_ref IS NOT NULL;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY; ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_select ON invoices FOR SELECT USING (app_is_system() OR tenant_id = app_current_tenant());
CREATE POLICY invoices_write ON invoices FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartseed_app') THEN
    GRANT SELECT, INSERT, UPDATE ON invoices TO smartseed_app;
    GRANT INSERT, UPDATE ON plans TO smartseed_app;
    GRANT UPDATE (status, trial_ends_at, renews_at, gateway_ref, plan_id) ON subscriptions TO smartseed_app;
  END IF;
END $$;

INSERT INTO permissions (code) VALUES ('platform:billing:manage'), ('billing:read');
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('platform_admin', 'platform:billing:manage'), ('company_admin', 'billing:read')
) AS m(role_name, perm) JOIN roles r ON r.name = m.role_name JOIN permissions p ON p.code = m.perm;

-- Down Migration
DROP TABLE IF EXISTS invoices CASCADE;
DROP TYPE IF EXISTS invoice_status;
ALTER TABLE plans DROP COLUMN IF EXISTS gateway_plan_id;
