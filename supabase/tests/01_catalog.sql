-- Read-only validation of the ACTUAL migrated database catalog.
-- This file was not run in the artifact-generation environment.
BEGIN;
DO $check$
DECLARE r record; n integer;
BEGIN
  IF current_setting('server_version_num')::integer<150000 THEN RAISE EXCEPTION 'PostgreSQL 15+ required'; END IF;
  FOR r IN SELECT unnest(ARRAY['production_data','production_targets','profiles','master_items','activity_logs','app_settings','buymore_user_factories']) AS name LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||r.name) AND relrowsecurity) THEN RAISE EXCEPTION 'RLS missing on %',r.name; END IF;
    IF has_table_privilege('anon','public.'||r.name,'SELECT,INSERT,UPDATE,DELETE') OR
       has_table_privilege('authenticated','public.'||r.name,'INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Unexpected direct table privilege on %',r.name; END IF;
    IF has_any_column_privilege('authenticated','public.'||r.name,'INSERT,UPDATE') THEN RAISE EXCEPTION 'Unexpected column write privilege on %',r.name; END IF;
    IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=r.name AND cmd<>'SELECT') THEN RAISE EXCEPTION 'Unexpected write policy on %',r.name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname LIKE 'buymore_%' AND NOT convalidated) THEN RAISE EXCEPTION 'A workflow constraint is not validated'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname LIKE 'buymore_%' GROUP BY p.proname HAVING count(*)>1) THEN RAISE EXCEPTION 'Unexpected workflow overload/duplicate function'; END IF;
  FOR r IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname LIKE 'buymore_%' LOOP
    IF has_function_privilege('anon',r.oid,'EXECUTE') THEN RAISE EXCEPTION 'Anonymous execution on %',r.proname; END IF;
    IF NOT EXISTS(SELECT 1 FROM unnest(r.proconfig) x WHERE x IN ('search_path=""','search_path=')) THEN RAISE EXCEPTION 'Unpinned search_path on %',r.proname; END IF;
    IF r.proname IN ('buymore_audit','buymore_write_guard','buymore_require','buymore_master_code','buymore_master_name','buymore_service_context') AND has_function_privilege('authenticated',r.oid,'EXECUTE') THEN RAISE EXCEPTION 'Exposed internal helper %',r.proname; END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['production_data','production_targets','profiles','master_items','buymore_user_factories','app_settings']) AS name LOOP
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid=to_regclass('public.'||r.name) AND tgname='buymore_write_guard' AND tgenabled IN ('O','A');
    IF n<>1 THEN RAISE EXCEPTION 'Write guard missing/disabled on %',r.name; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.activity_logs'::regclass AND tgname='buymore_audit_guard' AND tgenabled IN ('O','A')) THEN RAISE EXCEPTION 'Immutable audit guard missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='buymore_target_dimensions') THEN RAISE EXCEPTION 'Exact plan uniqueness missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='buymore_production_request') THEN RAISE EXCEPTION 'Idempotency uniqueness missing'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind='v' AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'],false)) THEN RAISE EXCEPTION 'A public view bypasses caller RLS'; END IF;
  RAISE NOTICE 'PASS: actual catalog checks';
END $check$;
ROLLBACK;
