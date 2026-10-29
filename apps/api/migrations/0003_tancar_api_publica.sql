-- Tanca l'accés directe a les taules.
--
-- Supabase publica automàticament una API REST (PostgREST) per a l'esquema public,
-- accessible amb la clau "anon", que és pública. Sense aquesta migració, qualsevol
-- persona amb aquesta clau podria llegir o modificar saldos i moviments.
--
-- Només l'API del projecte (que es connecta com a propietari de les taules) ha
-- d'accedir a les dades. Per això:
--   1. S'activa Row Level Security a totes les taules, sense cap política:
--      els rols que no en són propietaris no veuen ni poden tocar cap fila.
--   2. A Supabase, a més, es retiren tots els permisos als rols públics
--      (anon i authenticated), també per a les taules que es creïn més endavant.
--
-- En un PostgreSQL local (sense aquests rols) només s'aplica el punt 1, que no
-- afecta el servidor perquè es connecta com a propietari.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
