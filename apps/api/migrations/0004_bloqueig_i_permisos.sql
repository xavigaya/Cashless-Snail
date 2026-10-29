-- 1. Bloqueig per compte d'administrador després de massa contrasenyes errònies.
--    Complementa el límit per IP, que algú podria esquivar canviant d'adreça.
ALTER TABLE admin_users
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz;

-- 2. Reforç del tancament de l'API pública de Supabase (complementa la migració 0003).
--    Cap rol que no sigui el propietari ha de poder executar funcions de l'esquema public.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  r text;
  creator text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      CONTINUE;
    END IF;
    -- A Supabase, els permisos per defecte cap als rols públics es defineixen per als objectes
    -- que creen "postgres" i "supabase_admin". Es retiren explícitament per a tots dos.
    FOREACH creator IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = creator) THEN
        BEGIN
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', creator, r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', creator, r);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', creator, r);
        EXCEPTION WHEN insufficient_privilege THEN
          RAISE NOTICE 'Sense permís per canviar els permisos per defecte de %; es manté el de la migració 0003', creator;
        END;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- 3. Totes les taules amb Row Level Security, també les que no existien a la 0003.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
