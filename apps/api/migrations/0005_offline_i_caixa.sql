-- Fase 1: vendes sense connexió i tancaments de caixa.

-- 1. Vendes sense connexió ------------------------------------------------------
-- Import màxim que un TPV de barra pot cobrar per venda (i per polsera) quan no té xarxa.
-- 0 desactiva les vendes sense connexió en aquest esdeveniment.
ALTER TABLE events
  ADD COLUMN offline_sale_limit_cents integer NOT NULL DEFAULT 2000
    CHECK (offline_sale_limit_cents BETWEEN 0 AND 100000);

-- Una venda feta sense connexió es registra encara que el saldo no arribés:
-- el saldo pagat pot quedar negatiu (deute). Mentre hi hagi deute, la polsera no pot comprar.
ALTER TABLE wallets DROP CONSTRAINT wallets_paid_cents_check;

-- 2. Torns de caixa ---------------------------------------------------------------
-- Un torn és l'efectiu d'una taquilla mentre la porta un operador:
-- s'obre amb un fons de canvi i es tanca declarant l'efectiu comptat.
CREATE TABLE cash_shifts (
  id                      uuid PRIMARY KEY,
  event_id                uuid NOT NULL REFERENCES events (id),
  terminal_id             uuid NOT NULL REFERENCES terminals (id),
  operator_id             uuid NOT NULL REFERENCES operators (id),
  opening_float_cents     integer NOT NULL CHECK (opening_float_cents >= 0),
  opened_at               timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  closed_by_operator_id   uuid REFERENCES operators (id),
  closed_by_admin_id      uuid REFERENCES admin_users (id),
  declared_cash_cents     integer CHECK (declared_cash_cents >= 0),
  expected_cash_cents     integer,
  note                    text,
  CHECK ((closed_at IS NULL) = (declared_cash_cents IS NULL)),
  CHECK ((closed_at IS NULL) = (expected_cash_cents IS NULL))
);
-- Cada aparell de taquilla té un sol calaix: com a màxim un torn obert per terminal.
CREATE UNIQUE INDEX cash_shifts_one_open_per_terminal ON cash_shifts (terminal_id) WHERE closed_at IS NULL;
CREATE INDEX cash_shifts_event_idx ON cash_shifts (event_id, opened_at DESC);
ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;

-- 3. Moviments ------------------------------------------------------------------
ALTER TABLE movements
  ADD COLUMN offline boolean NOT NULL DEFAULT false,
  -- Codis d'error que s'haurien produït si la venda s'hagués fet amb connexió.
  ADD COLUMN offline_issues text[] NOT NULL DEFAULT '{}',
  ADD COLUMN shift_id uuid REFERENCES cash_shifts (id);
CREATE INDEX movements_shift_idx ON movements (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX movements_offline_issues_idx ON movements (event_id) WHERE cardinality(offline_issues) > 0;
