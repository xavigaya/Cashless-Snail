-- Cashless Snail · esquema inicial (fase 0)
-- Imports en cèntims d'euro (enters). Dates en UTC (timestamptz).

-- ---------------------------------------------------------------
-- Entitats i usuaris del backoffice
-- ---------------------------------------------------------------

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  tax_id      text,
  tax_regime  text NOT NULL CHECK (tax_regime IN ('association', 'company', 'self_employed', 'public_body')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_key ON admin_users (lower(email));

-- ---------------------------------------------------------------
-- Esdeveniments i la seva configuració
-- ---------------------------------------------------------------

CREATE TABLE events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations (id),
  name                     text NOT NULL,
  slug                     text NOT NULL UNIQUE,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  starts_at                timestamptz NOT NULL,
  ends_at                  timestamptz NOT NULL,
  wristband_price_cents    integer NOT NULL DEFAULT 0 CHECK (wristband_price_cents >= 0),
  wristband_deposit_cents  integer NOT NULL DEFAULT 0 CHECK (wristband_deposit_cents >= 0),
  max_balance_cents        integer NOT NULL DEFAULT 50000 CHECK (max_balance_cents > 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_organization_idx ON events (organization_id);

-- Rols del backoffice, cadascun lligat a un àmbit.
CREATE TABLE role_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'event_manager')),
  organization_id  uuid REFERENCES organizations (id) ON DELETE CASCADE,
  event_id         uuid REFERENCES events (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role = 'platform_admin' AND organization_id IS NULL AND event_id IS NULL) OR
    (role = 'org_admin' AND organization_id IS NOT NULL AND event_id IS NULL) OR
    (role = 'event_manager' AND event_id IS NOT NULL AND organization_id IS NULL)
  )
);
CREATE UNIQUE INDEX role_assignments_unique ON role_assignments
  (user_id, role, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'), coalesce(event_id, '00000000-0000-0000-0000-000000000000'));

-- Cada entitat que ven dins d'un esdeveniment. Té la seva pròpia liquidació.
CREATE TABLE vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  organization_id  uuid REFERENCES organizations (id),
  name             text NOT NULL,
  commission_bps   integer NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

CREATE TABLE points_of_sale (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  vendor_id   uuid REFERENCES vendors (id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('bar', 'kitchen', 'box_office')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  CHECK (kind = 'box_office' OR vendor_id IS NOT NULL)
);

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  vendor_id     uuid NOT NULL REFERENCES vendors (id),
  name          text NOT NULL,
  price_cents   integer NOT NULL CHECK (price_cents > 0),
  vat_rate_bps  integer NOT NULL DEFAULT 1000 CHECK (vat_rate_bps BETWEEN 0 AND 10000),
  category      text NOT NULL DEFAULT 'General',
  color         text NOT NULL DEFAULT '#3B6FB6',
  sort_order    integer NOT NULL DEFAULT 0,
  destination   text NOT NULL DEFAULT 'bar' CHECK (destination IN ('bar', 'kitchen')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_event_vendor_idx ON products (event_id, vendor_id);

-- ---------------------------------------------------------------
-- Operadors (voluntaris amb PIN) i terminals
-- ---------------------------------------------------------------

CREATE TABLE operators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name             text NOT NULL,
  pin_hash         text NOT NULL,
  role             text NOT NULL CHECK (role IN ('bar_lead', 'cashier', 'waiter', 'box_office')),
  active           boolean NOT NULL DEFAULT true,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

CREATE TABLE terminals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  point_of_sale_id    uuid NOT NULL REFERENCES points_of_sale (id),
  name                text NOT NULL,
  device_name         text,
  token_hash          text UNIQUE,
  pairing_code        text UNIQUE,
  pairing_expires_at  timestamptz,
  paired_at           timestamptz,
  last_seen_at        timestamptz,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX terminals_event_idx ON terminals (event_id);

-- ---------------------------------------------------------------
-- Polseres, saldos i llibre de moviments
-- ---------------------------------------------------------------

CREATE TABLE wristbands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid         text UNIQUE,
  code        text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'lost')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- El saldo pertany a l'entitat organitzadora, no a la polsera en general.
-- Aquesta taula és una còpia de treball: la font de veritat són els moviments.
CREATE TABLE wallets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wristband_id     uuid NOT NULL REFERENCES wristbands (id),
  organization_id  uuid NOT NULL REFERENCES organizations (id),
  paid_cents       integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  promo_cents      integer NOT NULL DEFAULT 0 CHECK (promo_cents >= 0),
  deposit_cents    integer NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wristband_id, organization_id)
);

-- Llibre de moviments: immutable. L'identificador el genera el client (idempotència).
CREATE TABLE movements (
  id                    uuid PRIMARY KEY,
  event_id              uuid NOT NULL REFERENCES events (id),
  organization_id       uuid NOT NULL REFERENCES organizations (id),
  wallet_id             uuid REFERENCES wallets (id),
  wristband_id          uuid REFERENCES wristbands (id),
  type                  text NOT NULL CHECK (type IN ('topup', 'sale', 'void', 'refund', 'wristband_fee', 'deposit', 'deposit_return', 'promo_grant')),
  payment_method        text NOT NULL CHECK (payment_method IN ('cash', 'card', 'online', 'wallet', 'none')),
  amount_cents          integer NOT NULL CHECK (amount_cents >= 0),
  paid_delta_cents      integer NOT NULL DEFAULT 0,
  promo_delta_cents     integer NOT NULL DEFAULT 0,
  deposit_delta_cents   integer NOT NULL DEFAULT 0,
  vendor_id             uuid REFERENCES vendors (id),
  point_of_sale_id      uuid REFERENCES points_of_sale (id),
  terminal_id           uuid REFERENCES terminals (id),
  operator_id           uuid REFERENCES operators (id),
  admin_user_id         uuid REFERENCES admin_users (id),
  reverses_movement_id  uuid UNIQUE REFERENCES movements (id),
  reason                text,
  request_hash          text NOT NULL,
  client_created_at     timestamptz,
  -- Precisió de mil·lisegons perquè coincideixi amb les dates de JavaScript (paginació per cursor).
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (type <> 'void' OR reverses_movement_id IS NOT NULL)
);
CREATE INDEX movements_event_created_idx ON movements (event_id, created_at DESC, id DESC);
CREATE INDEX movements_wallet_idx ON movements (wallet_id, created_at);
CREATE INDEX movements_vendor_idx ON movements (vendor_id) WHERE vendor_id IS NOT NULL;

-- Les dades del moviment no es poden modificar ni esborrar.
CREATE FUNCTION movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Els moviments són immutables: crea un moviment invers';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movements_no_update BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION movements_immutable();

CREATE TABLE movement_lines (
  id                bigserial PRIMARY KEY,
  movement_id       uuid NOT NULL REFERENCES movements (id),
  product_id        uuid NOT NULL REFERENCES products (id),
  name              text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL,
  vat_rate_bps      integer NOT NULL,
  total_cents       integer NOT NULL
);
CREATE INDEX movement_lines_movement_idx ON movement_lines (movement_id);
CREATE INDEX movement_lines_product_idx ON movement_lines (product_id);

-- ---------------------------------------------------------------
-- Auditoria de les accions administratives
-- ---------------------------------------------------------------

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor_type   text NOT NULL CHECK (actor_type IN ('admin', 'operator', 'terminal', 'system')),
  actor_id     uuid,
  event_id     uuid REFERENCES events (id) ON DELETE SET NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    uuid,
  data         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_event_idx ON audit_log (event_id, created_at DESC);
