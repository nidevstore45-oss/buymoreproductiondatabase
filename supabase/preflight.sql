-- Run and retain these result sets before migration. Read-only catalog checks.
SELECT current_setting('server_version') AS postgres_version;
SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position;
SELECT c.conrelid::regclass AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition,c.convalidated
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY 1,2;
SELECT * FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY schemaname,tablename,policyname;
SELECT t.tgrelid::regclass AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition,
  pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth'));
SELECT n.nspname,p.oid::regprocedure AS signature,p.prosecdef,p.proacl,p.proconfig,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;
SELECT * FROM information_schema.role_table_grants WHERE table_schema='public';
SELECT * FROM information_schema.role_column_grants WHERE table_schema='public';
-- Inspect auth signup hooks and invitation enforcement in the trigger results.
-- No full_name-to-user_id or guessed Factory backfill is permitted.
