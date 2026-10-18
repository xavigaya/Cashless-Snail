-- El bloqueig d'una polsera és per entitat: una entitat no pot bloquejar ni desbloquejar
-- la polsera per a les altres. L'estat global de wristbands queda reservat a la plataforma.
ALTER TABLE wallets
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'lost'));
