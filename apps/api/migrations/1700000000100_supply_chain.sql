-- Up Migration

CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE TYPE org_type AS ENUM ('manufacturer', 'distributor', 'wholesaler', 'retailer');
CREATE TYPE batch_status AS ENUM ('active', 'on_hold', 'recalled');
CREATE TYPE transfer_status AS ENUM ('created', 'dispatched', 'in_transit', 'received', 'rejected', 'cancelled');
CREATE TYPE movement_reason AS ENUM ('initial', 'transfer_out', 'transfer_in', 'sale', 'correction');
CREATE TYPE chain_status AS ENUM ('pending', 'submitted', 'committed', 'failed');

-- ---------- organizations (shared across tenants where an admin links them) ----------
CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  type org_type NOT NULL,
  legal_name text NOT NULL,
  registration_no text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, registration_no)
);

CREATE TABLE tenant_organizations (
  tenant_id uuid NOT NULL REFERENCES tenants,
  org_id uuid NOT NULL REFERENCES organizations,
  relationship text NOT NULL CHECK (relationship IN ('self', 'partner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_id)
);
CREATE UNIQUE INDEX tenant_self_org_uidx ON tenant_organizations (tenant_id) WHERE relationship = 'self';
CREATE INDEX tenant_organizations_org_idx ON tenant_organizations (org_id);

ALTER TABLE users ADD COLUMN org_id uuid REFERENCES organizations;
CREATE INDEX users_org_idx ON users (org_id);

-- Definer helper: lets policies ask "which tenants am I linked to" without recursive RLS.
-- tenant_organizations uses ENABLE (not FORCE) RLS so the owner-run definer bypasses it;
-- the application role is never the owner.
CREATE FUNCTION app_org_tenants() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT tenant_id FROM tenant_organizations WHERE org_id = app_current_org() $$;

-- ---------- catalogue ----------
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL,
  brand text NOT NULL,
  crop_type text NOT NULL,
  variety text NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  packaging jsonb NOT NULL DEFAULT '{}',
  regulatory_ids jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brand, name, variety)
);
CREATE INDEX products_tenant_idx ON products (tenant_id, created_at DESC, id);

CREATE TABLE seed_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid NOT NULL REFERENCES products,
  manufacturer_org_id uuid NOT NULL REFERENCES organizations,
  batch_code text NOT NULL,
  manufacturing_date date NOT NULL,
  expiry_date date NOT NULL,
  production_location text NOT NULL,
  facility text NOT NULL,
  initial_quantity integer NOT NULL CHECK (initial_quantity > 0),
  unit text NOT NULL,
  status batch_status NOT NULL DEFAULT 'active',
  record_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, batch_code),
  CHECK (expiry_date > manufacturing_date)
);
CREATE INDEX seed_batches_tenant_idx ON seed_batches (tenant_id, created_at DESC, id);
CREATE INDEX seed_batches_product_idx ON seed_batches (product_id);

CREATE TABLE certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  product_id uuid REFERENCES products,
  batch_id uuid REFERENCES seed_batches,
  type text NOT NULL,
  issuer text NOT NULL,
  number text NOT NULL,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((product_id IS NOT NULL) <> (batch_id IS NOT NULL))
);
CREATE INDEX certifications_batch_idx ON certifications (batch_id);
CREATE INDEX certifications_product_idx ON certifications (product_id);

-- ---------- inventory ----------
CREATE TABLE batch_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  org_id uuid NOT NULL REFERENCES organizations,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, org_id),
  CHECK (reserved <= quantity)
);
CREATE INDEX batch_holdings_org_idx ON batch_holdings (org_id);

CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  from_org uuid NOT NULL REFERENCES organizations,
  to_org uuid NOT NULL REFERENCES organizations,
  quantity integer NOT NULL CHECK (quantity > 0),
  received_quantity integer CHECK (received_quantity >= 0),
  status transfer_status NOT NULL DEFAULT 'created',
  under_investigation boolean NOT NULL DEFAULT false,
  idempotency_key text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users,
  source_location text,
  destination_location text,
  carrier text,
  vehicle_ref text,
  dispatched_at timestamptz,
  received_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_org, idempotency_key),
  CHECK (from_org <> to_org),
  CHECK (received_quantity IS NULL OR received_quantity <= quantity)
);
CREATE INDEX transfers_tenant_idx ON transfers (tenant_id, created_at DESC, id);
CREATE INDEX transfers_from_idx ON transfers (from_org, created_at DESC);
CREATE INDEX transfers_to_idx ON transfers (to_org, created_at DESC);
CREATE INDEX transfers_batch_idx ON transfers (batch_id);

-- Append-only quantity ledger; balance_after makes drift detectable.
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  holding_id uuid NOT NULL REFERENCES batch_holdings,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  org_id uuid NOT NULL REFERENCES organizations,
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason movement_reason NOT NULL,
  ref_type text,
  ref_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);
CREATE INDEX inventory_movements_holding_idx ON inventory_movements (holding_id, created_at DESC);
CREATE INDEX inventory_movements_batch_idx ON inventory_movements (batch_id, created_at);
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Rejected operations (validation failures) kept for risk analysis; written outside the failed transaction.
CREATE TABLE blocked_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants,
  batch_id uuid REFERENCES seed_batches,
  org_id uuid REFERENCES organizations,
  user_id uuid REFERENCES users,
  kind text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blocked_attempts_batch_idx ON blocked_attempts (batch_id, created_at DESC);
CREATE INDEX blocked_attempts_org_idx ON blocked_attempts (org_id, created_at DESC);

-- ---------- events and blockchain outbox ----------
CREATE TABLE supply_chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  batch_id uuid NOT NULL REFERENCES seed_batches,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  actor_org uuid NOT NULL REFERENCES organizations,
  counterparty_org uuid REFERENCES organizations,
  quantity integer,
  transfer_id uuid REFERENCES transfers,
  corrects_event_id uuid REFERENCES supply_chain_events,
  payload jsonb NOT NULL DEFAULT '{}',
  record_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, sequence)
);
CREATE INDEX supply_chain_events_actor_idx ON supply_chain_events (actor_org);
CREATE INDEX supply_chain_events_counterparty_idx ON supply_chain_events (counterparty_org);
CREATE TRIGGER supply_chain_events_append_only BEFORE UPDATE OR DELETE ON supply_chain_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Transactional outbox: written in the same transaction as the event it commits to chain.
CREATE TABLE blockchain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  event_id uuid NOT NULL UNIQUE REFERENCES supply_chain_events,
  chain_event_id text NOT NULL UNIQUE,
  function_name text NOT NULL,
  status chain_status NOT NULL DEFAULT 'pending',
  fabric_tx_id text,
  block_number bigint,
  validation_code text,
  signature text,
  signer_key_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blockchain_tx_pending_idx ON blockchain_transactions (next_attempt_at) WHERE status IN ('pending', 'submitted');

-- ---------- row level security ----------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;          ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE seed_batches ENABLE ROW LEVEL SECURITY;      ALTER TABLE seed_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;    ALTER TABLE certifications FORCE ROW LEVEL SECURITY;
ALTER TABLE batch_holdings ENABLE ROW LEVEL SECURITY;    ALTER TABLE batch_holdings FORCE ROW LEVEL SECURITY;
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;         ALTER TABLE transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY; ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE supply_chain_events ENABLE ROW LEVEL SECURITY; ALTER TABLE supply_chain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE blockchain_transactions ENABLE ROW LEVEL SECURITY; ALTER TABLE blockchain_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE blocked_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE blocked_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_orgs_select ON tenant_organizations FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR org_id = app_current_org()
         OR tenant_id IN (SELECT app_org_tenants()));
CREATE POLICY tenant_orgs_write ON tenant_organizations FOR ALL
  USING (app_is_system()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY orgs_select ON organizations FOR SELECT
  USING (app_is_system() OR id IN (SELECT org_id FROM tenant_organizations));
CREATE POLICY orgs_insert ON organizations FOR INSERT
  WITH CHECK (app_is_system() OR app_current_tenant() IS NOT NULL);

CREATE POLICY products_select ON products FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR id IN (SELECT product_id FROM seed_batches));
CREATE POLICY products_write ON products FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY batches_select ON seed_batches FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant()
         OR id IN (SELECT batch_id FROM batch_holdings) OR id IN (SELECT batch_id FROM transfers));
CREATE POLICY batches_write ON seed_batches FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY certs_select ON certifications FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant()
         OR batch_id IN (SELECT id FROM seed_batches) OR product_id IN (SELECT id FROM products));
CREATE POLICY certs_write ON certifications FOR ALL
  USING (app_is_system() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY holdings_select ON batch_holdings FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR org_id = app_current_org());
CREATE POLICY holdings_write ON batch_holdings FOR ALL
  USING (app_is_system()) WITH CHECK (app_is_system());

CREATE POLICY transfers_select ON transfers FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR from_org = app_current_org() OR to_org = app_current_org());
CREATE POLICY transfers_write ON transfers FOR ALL
  USING (app_is_system()) WITH CHECK (app_is_system());

CREATE POLICY movements_select ON inventory_movements FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR org_id = app_current_org());
CREATE POLICY movements_insert ON inventory_movements FOR INSERT WITH CHECK (app_is_system());

CREATE POLICY events_select ON supply_chain_events FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant()
         OR actor_org = app_current_org() OR counterparty_org = app_current_org());
CREATE POLICY events_insert ON supply_chain_events FOR INSERT WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY chain_tx_select ON blockchain_transactions FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR event_id IN (SELECT id FROM supply_chain_events));
CREATE POLICY chain_tx_write ON blockchain_transactions FOR ALL
  USING (app_is_system()) WITH CHECK (app_is_system() OR tenant_id = app_current_tenant());

CREATE POLICY attempts_select ON blocked_attempts FOR SELECT
  USING (app_is_system() OR tenant_id = app_current_tenant() OR org_id = app_current_org());
CREATE POLICY attempts_insert ON blocked_attempts FOR INSERT WITH CHECK (app_is_system());

-- ---------- grants ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smartseed_app') THEN
    GRANT SELECT, INSERT ON organizations TO smartseed_app;
    GRANT SELECT, INSERT, DELETE ON tenant_organizations TO smartseed_app;
    GRANT SELECT, INSERT, UPDATE ON products, seed_batches, certifications, batch_holdings, transfers TO smartseed_app;
    GRANT SELECT, INSERT ON inventory_movements, supply_chain_events, blocked_attempts TO smartseed_app;
    GRANT SELECT, INSERT, UPDATE ON blockchain_transactions TO smartseed_app;
  END IF;
END $$;

-- ---------- RBAC seed ----------
INSERT INTO permissions (code) VALUES
  ('org:read'), ('org:write'), ('product:read'), ('product:write'), ('batch:read'), ('batch:create'),
  ('inventory:read'), ('transfer:read'), ('transfer:create'), ('transfer:receive'), ('sale:record'),
  ('platform:org:link');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('platform_admin', 'platform:org:link'),
  ('company_admin', 'org:read'), ('company_admin', 'org:write'), ('company_admin', 'product:read'),
  ('company_admin', 'product:write'), ('company_admin', 'batch:read'), ('company_admin', 'transfer:read'),
  ('company_admin', 'inventory:read'),
  ('manufacturer', 'org:read'), ('manufacturer', 'product:read'), ('manufacturer', 'product:write'),
  ('manufacturer', 'batch:read'), ('manufacturer', 'batch:create'), ('manufacturer', 'inventory:read'),
  ('manufacturer', 'transfer:read'), ('manufacturer', 'transfer:create'),
  ('distributor', 'org:read'), ('distributor', 'product:read'), ('distributor', 'batch:read'),
  ('distributor', 'inventory:read'), ('distributor', 'transfer:read'), ('distributor', 'transfer:create'),
  ('distributor', 'transfer:receive'),
  ('wholesaler', 'org:read'), ('wholesaler', 'product:read'), ('wholesaler', 'batch:read'),
  ('wholesaler', 'inventory:read'), ('wholesaler', 'transfer:read'), ('wholesaler', 'transfer:create'),
  ('wholesaler', 'transfer:receive'),
  ('retailer', 'org:read'), ('retailer', 'product:read'), ('retailer', 'batch:read'),
  ('retailer', 'inventory:read'), ('retailer', 'transfer:read'), ('retailer', 'transfer:receive'),
  ('retailer', 'sale:record')
) AS m(role_name, perm) JOIN roles r ON r.name = m.role_name JOIN permissions p ON p.code = m.perm;

-- Down Migration
DROP TABLE IF EXISTS blocked_attempts, blockchain_transactions, supply_chain_events, inventory_movements, transfers,
  batch_holdings, certifications, seed_batches, products, tenant_organizations, organizations CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS org_id;
DROP FUNCTION IF EXISTS app_org_tenants(), app_current_org();
DROP TYPE IF EXISTS chain_status, movement_reason, transfer_status, batch_status, org_type;
