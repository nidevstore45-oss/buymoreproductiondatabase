-- PRODUCTION BUYMORE: additive upgrade of the uploaded source's existing tables.
-- Run preflight.sql and rehearse on a BACKUP/clone before production.
-- The uploaded repository did NOT contain the deployed schema or policies.
-- Unsupported column types cause this entire transaction to roll back.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
DECLARE r record; actual text; date_type text; target_date_type text;
BEGIN
  -- Reject a separate Factory model that was not present in the uploaded code.
  IF to_regprocedure('public.buymore_admin_check()') IS NULL AND (
      to_regclass('public.factories') IS NOT NULL OR to_regclass('public.factory') IS NOT NULL OR
      to_regclass('public.user_factories') IS NOT NULL OR
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name IN ('profiles','production_data','production_targets') AND column_name IN ('factory_id','factory_uuid'))
    ) THEN RAISE EXCEPTION 'EXISTING_FACTORY_MODEL_REQUIRES_RECONCILIATION: stop; reuse the deployed model before applying this release.'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('profiles','id','uuid'), ('profiles','role','text'),
    ('profiles','is_active','boolean'), ('profiles','full_name','text'),
    ('master_items','category','text'),('master_items','code','text'),
    ('master_items','name','text'),('master_items','is_active','boolean'),
    ('production_data','created_by','text'),('production_data','product','text'),
    ('production_data','color','text'),('production_data','shift','text'),
    ('production_data','note','text'),('production_targets','product','text'),
    ('production_targets','shift','text'),('activity_logs','description','text'),
    ('activity_logs','user_name','text'),('activity_logs','table_name','text'),
    ('activity_logs','record_id','text'),('activity_logs','activity_type','text'),
    ('app_settings','key','text'),('app_settings','value','jsonb')
  ) AS x(tab,col,typ)
  LOOP
    SELECT format_type(a.atttypid,a.atttypmod) INTO actual FROM pg_attribute a
    WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname=r.col AND NOT a.attisdropped;
    IF actual IS NULL OR (actual<>r.typ AND NOT (r.typ='text' AND actual LIKE 'character varying%')) THEN
      RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: %.% expected %, got %. No data changed.',r.tab,r.col,r.typ,coalesce(actual,'MISSING');
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('production_data','id'),('production_data','date'),('production_data','time'),
    ('production_data','quantity'),('production_data','created_at'),('production_data','deleted_at'),
    ('production_data','work_order_id'),('production_data','batch_id'),
    ('production_data','machine_code'),('production_data','line_code'),('production_data','source'),
    ('production_targets','id'),('production_targets','target_date'),
    ('production_targets','target_quantity'),('production_targets','created_by'),
    ('production_targets','note'),('production_targets','created_at'),
    ('master_items','id'),('master_items','created_by'),('master_items','metadata'),
    ('activity_logs','id'),('activity_logs','created_at'),('profiles','email')
  ) AS x(tab,col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||r.tab) AND attname=r.col AND NOT attisdropped) THEN
      RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: %.% missing. Restore original migrations first.',r.tab,r.col;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('production_data','quantity',ARRAY['int4','int8','numeric']),
    ('production_targets','target_quantity',ARRAY['int4','int8','numeric']),
    ('production_targets','created_by',ARRAY['uuid']),('master_items','created_by',ARRAY['uuid']),
    ('master_items','metadata',ARRAY['jsonb']),('production_data','created_at',ARRAY['timestamptz']),
    ('production_data','deleted_at',ARRAY['timestamptz']),('activity_logs','created_at',ARRAY['timestamptz']),
    ('production_targets','created_at',ARRAY['timestamptz']),
    ('production_data','id',ARRAY['int4','int8','uuid']),('production_targets','id',ARRAY['int4','int8','uuid']),
    ('master_items','id',ARRAY['int4','int8','uuid']),('activity_logs','id',ARRAY['int4','int8','uuid']),
    ('production_data','time',ARRAY['text','varchar','time'])
  ) AS x(tab,col,types)
  LOOP
    SELECT t.typname INTO actual FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname=r.col AND NOT a.attisdropped;
    IF actual IS NULL OR NOT actual=ANY(r.types) THEN
      RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: %.% type % requires review.',r.tab,r.col,actual;
    END IF;
  END LOOP;
  SELECT udt_name INTO date_type FROM information_schema.columns WHERE table_schema='public' AND table_name='production_data' AND column_name='date';
  SELECT udt_name INTO target_date_type FROM information_schema.columns WHERE table_schema='public' AND table_name='production_targets' AND column_name='target_date';
  IF date_type IS NULL OR target_date_type IS NULL OR NOT (
      (date_type='date' AND target_date_type='date') OR
      (date_type IN ('text','varchar') AND target_date_type IN ('text','varchar'))
    ) THEN RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: production and target dates must both be DATE or ISO date text.'; END IF;
  IF date_type IN ('text','varchar') AND EXISTS(SELECT 1 FROM public.production_data WHERE date IS NOT NULL AND date::text !~ '^\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: historical production dates are not ISO date text.';
  END IF;
  IF target_date_type IN ('text','varchar') AND EXISTS(SELECT 1 FROM public.production_targets WHERE target_date IS NOT NULL AND target_date::text !~ '^\d{4}-\d{2}-\d{2}$') THEN
    RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: historical plan dates are not ISO date text.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE role='admin' AND is_active) THEN
    RAISE EXCEPTION 'ACTIVE_ADMIN_REQUIRED: no automatic promotion or guessed administrator is permitted.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.master_items WHERE category IS NULL OR code IS NULL OR btrim(code)='') THEN
    RAISE EXCEPTION 'MASTER_IDENTITY_REQUIRED: reconcile existing category/code without deleting history.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.master_items GROUP BY category,upper(btrim(code)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'MASTER_CASE_AMBIGUITY: case-insensitive master codes must be unique before this upgrade.';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='category'
    WHERE c.conrelid='public.master_items'::regclass AND c.contype='c' AND a.attnum=ANY(c.conkey) AND cardinality(c.conkey)<>1) THEN
    RAISE EXCEPTION 'CATEGORY_CONSTRAINT_REVIEW_REQUIRED: do not weaken a multi-column category check.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.master_items GROUP BY category,code HAVING count(*)>1) THEN
    RAISE EXCEPTION 'MASTER_DUPLICATE: category/code duplicates must be reconciled without deleting history.';
  END IF;
END $preflight$;

-- Preserve all existing category values while allowing the requested FACTORY category.
-- An enum or an unrecognized restrictive category design was rejected above.
DO $category$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conname,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.conrelid='public.master_items'::regclass
      AND c.contype='c' AND pg_get_constraintdef(c.oid) ~* '\mcategory\M'
  LOOP
    IF r.definition NOT ILIKE '%FACTORY%' THEN
      EXECUTE format('ALTER TABLE public.master_items DROP CONSTRAINT %I',r.conname);
      EXECUTE format('ALTER TABLE public.master_items ADD CONSTRAINT %I CHECK ((%s) OR category = ''FACTORY'') NOT VALID',r.conname,
        regexp_replace(regexp_replace(r.definition,'^CHECK \(','','i'),'\)( NOT VALID)?$','','i'));
    END IF;
  END LOOP;
END $category$;
CREATE UNIQUE INDEX IF NOT EXISTS buymore_master_category_code ON public.master_items(category,code);
ALTER TABLE public.master_items ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.master_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text DEFAULT 'id';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS description_id text;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS description_zh text;

-- This is the only new business table: existing master_items owns Factory identity.
CREATE TABLE IF NOT EXISTS public.buymore_user_factories (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  factory_category text NOT NULL DEFAULT 'FACTORY' CHECK(factory_category='FACTORY'),
  factory_code text NOT NULL,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,factory_code),
  FOREIGN KEY(factory_category,factory_code) REFERENCES public.master_items(category,code) ON DELETE RESTRICT
);

ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS created_by_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS factory_code text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS product_master_code text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS color_master_code text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS shift_master_code text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'LEGACY';
-- Existing rows remain LEGACY, not falsely verified.
ALTER TABLE public.production_data ALTER COLUMN verification_status SET DEFAULT 'SUBMITTED';
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.production_data ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS factory_code text;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS product_master_code text;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS color_master_code text;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS shift_master_code text;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.production_targets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Existing columns are not silently retyped by ADD COLUMN IF NOT EXISTS.
DO $existing_columns$
DECLARE r record; actual text; bad boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('production_data','created_by_id','uuid'),('production_data','verified_by','uuid'),
    ('production_data','verification_status','text'),('production_data','client_request_id','uuid'),
    ('production_data','request_fingerprint','text'),('production_data','metadata','jsonb'),
    ('activity_logs','user_id','uuid'),('activity_logs','metadata','jsonb'),
    ('production_targets','is_active','bool'),('buymore_user_factories','user_id','uuid'),
    ('buymore_user_factories','factory_code','text')
  ) AS x(tab,col,typ)
  LOOP
    SELECT t.typname INTO actual FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname=r.col AND NOT a.attisdropped;
    IF actual IS DISTINCT FROM r.typ AND NOT (r.typ='text' AND actual='varchar') THEN
      RAISE EXCEPTION 'SCHEMA_CONTRACT_MISMATCH: existing %.% is %, expected %.',r.tab,r.col,actual,r.typ;
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['production_data','production_targets','master_items']) AS tab LOOP
    SELECT t.typname INTO actual FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname='version' AND NOT a.attisdropped;
    IF actual NOT IN ('int4','int8') THEN RAISE EXCEPTION 'VERSION_CONTRACT_MISMATCH: %.version',r.tab; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE version IS NULL OR version < 1 OR version > 2147483646)',r.tab) INTO bad;
    IF bad THEN RAISE EXCEPTION 'VERSION_CONTRACT_MISMATCH: null, exhausted, or invalid versions in %. No silent backfill.',r.tab; END IF;
  END LOOP;
END $existing_columns$;

-- Composite FKs prevent a color being used as a Factory, etc. Historical null references survive.
DO $references$
DECLARE tab text; kind text; col text; cname text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['production_data','production_targets'] LOOP
    FOREACH kind IN ARRAY ARRAY['FACTORY','PRODUCT','COLOR','SHIFT'] LOOP
      col:=CASE kind WHEN 'FACTORY' THEN 'factory_code' ELSE lower(kind)||'_master_code' END;
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text NOT NULL DEFAULT %L',tab,lower(kind)||'_category',kind);
      cname:='buymore_'||tab||'_'||lower(kind)||'_category_check';
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||tab) AND conname=cname) THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = %L) NOT VALID',tab,cname,lower(kind)||'_category',kind);
      END IF;
      cname:='buymore_'||tab||'_'||lower(kind)||'_fk';
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||tab) AND conname=cname) THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I,%I) REFERENCES public.master_items(category,code) ON DELETE RESTRICT NOT VALID',tab,cname,lower(kind)||'_category',col);
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.production_data'::regclass AND conname='buymore_production_status_check') THEN
    ALTER TABLE public.production_data ADD CONSTRAINT buymore_production_status_check
      CHECK(verification_status IN ('LEGACY','SUBMITTED','VERIFIED','REJECTED')) NOT VALID;
  END IF;
END $references$;
-- Extend only a recognizable legacy single-column Shift allowlist.
-- The new canonical Shift FK plus RPC lookup replaces a hardcoded Siang/Malam list.
DO $shift_checks$
DECLARE r record; tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['production_data','production_targets'] LOOP
    FOR r IN SELECT c.conname,c.conkey,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='shift'
      WHERE c.conrelid=to_regclass('public.'||tab) AND c.contype='c' AND a.attnum=ANY(c.conkey)
    LOOP
      IF r.definition NOT ILIKE '%shift_master_code%' THEN
        IF cardinality(r.conkey)<>1 THEN RAISE EXCEPTION 'SHIFT_CONSTRAINT_REVIEW_REQUIRED: %.%',tab,r.conname; END IF;
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',tab,r.conname);
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((%s) OR shift_master_code IS NOT NULL) NOT VALID',tab,r.conname,
          regexp_replace(regexp_replace(r.definition,'^CHECK \(','','i'),'\)( NOT VALID)?$','','i'));
      END IF;
    END LOOP;
  END LOOP;
END $shift_checks$;
-- Checks are validated before COMMIT. Existing LEGACY rows are preserved as history.
DO $data_checks$
DECLARE tab text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.production_data'::regclass AND conname='buymore_production_complete_check') THEN
    ALTER TABLE public.production_data ADD CONSTRAINT buymore_production_complete_check CHECK(
      verification_status IS NOT NULL AND (verification_status='LEGACY' OR
        (date IS NOT NULL AND quantity IS NOT NULL AND quantity BETWEEN 1 AND 2147483647 AND quantity=trunc(quantity)
          AND factory_code IS NOT NULL AND product_master_code IS NOT NULL AND color_master_code IS NOT NULL AND shift_master_code IS NOT NULL))
    ) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.production_data'::regclass AND conname='buymore_production_review_check') THEN
    ALTER TABLE public.production_data ADD CONSTRAINT buymore_production_review_check CHECK(
      (verification_status NOT IN ('VERIFIED','REJECTED') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
      AND (verification_status<>'REJECTED' OR coalesce(length(btrim(rejection_reason)),0) BETWEEN 1 AND 2000)
    ) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.production_targets'::regclass AND conname='buymore_plan_quantity_check') THEN
    ALTER TABLE public.production_targets ADD CONSTRAINT buymore_plan_quantity_check CHECK(
      NOT is_active OR factory_code IS NULL OR product_master_code IS NULL OR color_master_code IS NULL OR shift_master_code IS NULL OR
      (target_date IS NOT NULL AND target_quantity IS NOT NULL AND target_quantity BETWEEN 1 AND 2147483647 AND target_quantity=trunc(target_quantity))
    ) NOT VALID;
  END IF;
  FOREACH tab IN ARRAY ARRAY['production_data','production_targets','master_items'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.'||tab) AND conname='buymore_version_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT buymore_version_check CHECK (version IS NOT NULL AND version BETWEEN 1 AND 2147483647) NOT VALID',tab);
    END IF;
  END LOOP;
END $data_checks$;
CREATE UNIQUE INDEX IF NOT EXISTS buymore_production_request ON public.production_data(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS buymore_production_scope_date ON public.production_data(factory_code,date,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS buymore_production_owner ON public.production_data(created_by_id,date,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS buymore_production_plan_match ON public.production_data(date,factory_code,product_master_code,color_master_code,shift_master_code) INCLUDE(quantity) WHERE deleted_at IS NULL AND verification_status='VERIFIED';
CREATE INDEX IF NOT EXISTS buymore_production_pending ON public.production_data(verification_status,factory_code,id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS buymore_target_dimensions ON public.production_targets(target_date,factory_code,product_master_code,color_master_code,shift_master_code)
  WHERE is_active AND factory_code IS NOT NULL AND product_master_code IS NOT NULL AND color_master_code IS NOT NULL AND shift_master_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS buymore_target_scope_date ON public.production_targets(factory_code,target_date);
CREATE INDEX IF NOT EXISTS buymore_activity_reference ON public.activity_logs(table_name,record_id,created_at DESC);

-- Functions use the caller's verified JWT, never editable user_metadata roles.
CREATE OR REPLACE FUNCTION public.buymore_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p.role::text FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active
    AND p.role::text IN ('admin','supervisor','operator')
$fn$;
CREATE OR REPLACE FUNCTION public.buymore_factory_access(p_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT coalesce(public.buymore_role()='admin' OR (public.buymore_role() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.buymore_user_factories f WHERE f.user_id=auth.uid() AND f.factory_code=p_code)),false)
$fn$;
CREATE OR REPLACE FUNCTION public.buymore_require(p_manager boolean DEFAULT false,p_admin boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE role_name text:=public.buymore_role();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF role_name IS NULL OR (p_manager AND role_name NOT IN ('admin','supervisor')) OR (p_admin AND role_name<>'admin') THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;
  IF (p_manager OR p_admin) AND coalesce((SELECT value <> 'false'::jsonb FROM public.app_settings WHERE key='require_manager_mfa'),true)
      AND coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' THEN RAISE EXCEPTION 'MFA_AAL2_REQUIRED'; END IF;
  RETURN auth.uid();
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_reason(p_reason text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $fn$
BEGIN
  IF coalesce(length(btrim(p_reason)),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ALASAN_WAJIB_MAKS_2000'; END IF;
  RETURN btrim(p_reason);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_master_code(p_category text,p_value text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE codes text[];
BEGIN
  SELECT array_agg(code) INTO codes FROM public.master_items WHERE category=p_category AND upper(code)=upper(btrim(p_value));
  IF coalesce(cardinality(codes),0)=1 THEN
    IF NOT EXISTS(SELECT 1 FROM public.master_items WHERE category=p_category AND code=codes[1] AND is_active) THEN
      RAISE EXCEPTION 'MASTER_TIDAK_AKTIF_ATAU_AMBIGU: % / %',p_category,p_value;
    END IF;
    RETURN codes[1];
  END IF;
  IF coalesce(cardinality(codes),0)=0 THEN
    SELECT array_agg(code) INTO codes FROM public.master_items WHERE category=p_category AND is_active AND upper(name)=upper(btrim(p_value));
  END IF;
  IF coalesce(cardinality(codes),0)<>1 THEN RAISE EXCEPTION 'MASTER_TIDAK_AKTIF_ATAU_AMBIGU: % / %',p_category,p_value; END IF;
  RETURN codes[1];
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_master_name(p_category text,p_code text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT name FROM public.master_items WHERE category=p_category AND code=p_code
$fn$;
CREATE OR REPLACE FUNCTION public.buymore_service_context() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $fn$
  SELECT coalesce(auth.role()='service_role',false) OR (
    auth.uid() IS NULL AND session_user::text IN ('postgres','supabase_admin','supabase_auth_admin')
    AND coalesce(current_setting('role',true),'none') NOT IN ('anon','authenticated')
    AND coalesce(auth.role(),'') NOT IN ('anon','authenticated'))
$fn$;

-- Revoke old privileged application RPC entry points: otherwise they can bypass new RLS.
-- Definitions and data are retained. See preflight.sql for their prior ACLs and bodies.
-- Legacy optional RPCs require a separate security review before regranting execution.
DO $legacy_rpc$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.proname NOT LIKE 'buymore_%'
      AND p.prokind='f' AND p.prorettype<>'trigger'::regtype
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
  END LOOP;
END $legacy_rpc$;

-- Replace policies only on the seven tables whose permissions this release owns.
DO $policies$
DECLARE tab text; r record;
BEGIN
  FOREACH tab IN ARRAY ARRAY['production_data','production_targets','profiles','master_items','activity_logs','app_settings','buymore_user_factories'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tab LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,tab);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  END LOOP;
END $policies$;
CREATE POLICY buymore_production_read ON public.production_data FOR SELECT TO authenticated USING (
  (SELECT public.buymore_role())='admin' OR
  (factory_code IN (SELECT f.factory_code FROM public.buymore_user_factories f WHERE f.user_id=(SELECT auth.uid()))
    AND ((SELECT public.buymore_role())='supervisor' OR
      ((SELECT public.buymore_role())='operator' AND created_by_id=(SELECT auth.uid())))));
CREATE POLICY buymore_target_read ON public.production_targets FOR SELECT TO authenticated USING(
  (SELECT public.buymore_role())='admin' OR ((SELECT public.buymore_role())='supervisor'
    AND factory_code IN (SELECT f.factory_code FROM public.buymore_user_factories f WHERE f.user_id=(SELECT auth.uid()))));
CREATE POLICY buymore_profile_read ON public.profiles FOR SELECT TO authenticated USING(id=(SELECT auth.uid()) OR (SELECT public.buymore_role())='admin');
CREATE POLICY buymore_master_read ON public.master_items FOR SELECT TO authenticated USING((SELECT public.buymore_role()) IS NOT NULL);
CREATE POLICY buymore_settings_read ON public.app_settings FOR SELECT TO authenticated USING((SELECT public.buymore_role()) IS NOT NULL);
CREATE POLICY buymore_membership_read ON public.buymore_user_factories FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) OR (SELECT public.buymore_role())='admin');
CREATE POLICY buymore_activity_read ON public.activity_logs FOR SELECT TO authenticated USING(
  (SELECT public.buymore_role())='admin' OR ((SELECT public.buymore_role())='supervisor'
    AND metadata->>'factory_code' IN (SELECT f.factory_code FROM public.buymore_user_factories f WHERE f.user_id=(SELECT auth.uid()))));

-- Harden views that can read protected records. security_invoker preserves base-table RLS.
DO $views$
DECLARE r record;
BEGIN
  IF current_setting('server_version_num')::integer<150000 THEN RAISE EXCEPTION 'PostgreSQL 15+ diperlukan untuk security_invoker views'; END IF;
  FOR r IN SELECT DISTINCT v.oid::regclass AS name FROM pg_class v JOIN pg_namespace n ON n.oid=v.relnamespace
    WHERE n.nspname='public' AND v.relkind='v'
  LOOP EXECUTE format('ALTER VIEW %s SET (security_invoker=true)',r.name); END LOOP;
  -- Materialized views store snapshots outside RLS; never expose them to browser roles.
  FOR r IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='m'
  LOOP EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated',r.name); END LOOP;
END $views$;

CREATE OR REPLACE FUNCTION public.buymore_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE op text:=current_setting('buymore.operation',true); actor uuid; role_name text;
BEGIN
  -- Auth signup may never assign a privileged role from editable signup metadata.
  IF TG_TABLE_NAME='profiles' AND TG_OP='INSERT' AND pg_trigger_depth()>1
      AND auth.uid() IS NULL AND coalesce(auth.role(),'')<>'service_role' THEN
    NEW.role:='operator'; NEW.is_active:=false; RETURN NEW;
  END IF;
  IF public.buymore_service_context() THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_TABLE_NAME='profiles' AND TG_OP='UPDATE' AND op='LANGUAGE' THEN
    PERFORM public.buymore_require();
    IF NEW.id IS DISTINCT FROM auth.uid() OR (to_jsonb(NEW)-'language'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'language'-'updated_at') THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;
    RETURN NEW;
  END IF;
  actor:=public.buymore_require(TG_OP<>'INSERT' OR TG_TABLE_NAME<>'production_data',TG_TABLE_NAME IN ('master_items','profiles','buymore_user_factories','app_settings'));
  role_name:=public.buymore_role();
  IF TG_TABLE_NAME='activity_logs' THEN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'AUDIT_IMMUTABLE'; END IF;
    IF current_user::text NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'AUDIT_RPC_ONLY'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND TG_TABLE_NAME<>'buymore_user_factories' THEN RAISE EXCEPTION 'HARD_DELETE_NOT_ALLOWED'; END IF;
  IF coalesce(op,'') NOT IN ('SUBMIT','VERIFY','REJECT','CORRECT','PLAN_SAVE','MASTER_SAVE','USER_ACCESS') THEN RAISE EXCEPTION 'MUTATION_RPC_REQUIRED'; END IF;
  IF TG_TABLE_NAME='production_data' THEN
    IF NOT public.buymore_factory_access(NEW.factory_code) OR (TG_OP='UPDATE' AND NOT public.buymore_factory_access(OLD.factory_code)) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
    IF TG_OP='INSERT' AND (NEW.created_by_id IS DISTINCT FROM actor OR NEW.verification_status<>'SUBMITTED') THEN RAISE EXCEPTION 'INVALID_PRODUCTION_ACTOR_STATUS'; END IF;
    IF TG_OP='UPDATE' AND role_name NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;
    IF NEW.quantity<=0 OR NEW.quantity<>trunc(NEW.quantity) THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
  ELSIF TG_TABLE_NAME='production_targets' THEN
    IF NOT public.buymore_factory_access(NEW.factory_code) OR (TG_OP='UPDATE' AND NOT public.buymore_factory_access(OLD.factory_code)) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $fn$;
-- The authorization guards also protect against legacy privileged mutation functions.
DO $guards$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['production_data','production_targets','master_items','profiles','buymore_user_factories','app_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS buymore_write_guard ON public.%I',tab);
    EXECUTE format('CREATE TRIGGER buymore_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.buymore_write_guard()',tab);
  END LOOP;
END $guards$;
-- Separate immutable-log guard allows existing trigger loggers, but disallows client writes.
CREATE OR REPLACE FUNCTION public.buymore_audit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF TG_OP<>'INSERT' AND NOT public.buymore_service_context() THEN RAISE EXCEPTION 'AUDIT_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' AND current_user::text IN ('anon','authenticated') THEN RAISE EXCEPTION 'AUDIT_RPC_ONLY'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $fn$;
DROP TRIGGER IF EXISTS buymore_audit_guard ON public.activity_logs;
CREATE TRIGGER buymore_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.buymore_audit_guard();
CREATE OR REPLACE FUNCTION public.buymore_audit(p_event text,p_table text,p_id text,p_reason text,p_old jsonb,p_new jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor_name text;
BEGIN
  SELECT coalesce(nullif(full_name,''),email,id::text) INTO actor_name FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.activity_logs(user_id,user_name,activity_type,table_name,record_id,description,description_id,metadata,created_at)
  VALUES(auth.uid(),coalesce(actor_name,'SYSTEM'),CASE WHEN p_old IS NULL THEN 'INSERT' ELSE 'UPDATE' END,p_table,p_id,
    p_event||': '||coalesce(p_reason,''),p_event||': '||coalesce(p_reason,''),
    jsonb_build_object('event_subtype',p_event,'actor_id',auth.uid(),'factory_code',coalesce(p_new->>'factory_code',p_old->>'factory_code'),
      'reason',p_reason,'old_data',p_old,'new_data',p_new),clock_timestamp());
END $fn$;

CREATE OR REPLACE FUNCTION public.buymore_save_production(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(); row_data public.production_data%ROWTYPE; candidate public.production_data%ROWTYPE;
  request_id uuid:=(p_payload->>'client_request_id')::uuid; fingerprint text:=md5(p_payload::text);
  f text; p text; c text; s text; qty bigint;
BEGIN
  IF request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,0));
  SELECT * INTO row_data FROM public.production_data WHERE client_request_id=request_id;
  IF FOUND THEN
    IF row_data.created_by_id IS DISTINCT FROM actor OR row_data.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    IF NOT public.buymore_factory_access(row_data.factory_code) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
    RETURN jsonb_build_object('saved',true,'replayed',true,'record',to_jsonb(row_data)||jsonb_build_object('id',row_data.id::text));
  END IF;
  IF coalesce(p_payload->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
  qty:=(p_payload->>'quantity')::bigint;
  IF qty NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
  IF coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
  PERFORM (p_payload->>'date')::date;
  f:=public.buymore_master_code('FACTORY',p_payload->>'factory_code');
  IF NOT public.buymore_factory_access(f) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
  p:=public.buymore_master_code('PRODUCT',p_payload->>'product'); c:=public.buymore_master_code('COLOR',p_payload->>'color'); s:=public.buymore_master_code('SHIFT',p_payload->>'shift');
  IF length(coalesce(p_payload->>'note',''))>4000 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;
  candidate:=jsonb_populate_record(NULL::public.production_data,p_payload || jsonb_build_object(
    'time',to_char(clock_timestamp() AT TIME ZONE 'Asia/Jakarta','HH24:MI:SS'),
    'created_by',(SELECT coalesce(nullif(full_name,''),email,id::text) FROM public.profiles WHERE id=actor),
    'created_by_id',actor,'factory_code',f,'product_master_code',p,'color_master_code',c,'shift_master_code',s,
    'product',public.buymore_master_name('PRODUCT',p),'color',public.buymore_master_name('COLOR',c),'shift',public.buymore_master_name('SHIFT',s)));
  PERFORM set_config('buymore.operation','SUBMIT',true);
  INSERT INTO public.production_data(date,time,product,color,shift,quantity,note,created_by,created_by_id,factory_code,product_master_code,color_master_code,shift_master_code,
    verification_status,version,client_request_id,request_fingerprint,work_order_id,batch_id,machine_code,line_code,source,metadata)
  VALUES(candidate.date,candidate.time,candidate.product,candidate.color,candidate.shift,qty,candidate.note,candidate.created_by,actor,f,p,c,s,'SUBMITTED',1,request_id,fingerprint,
    candidate.work_order_id,candidate.batch_id,candidate.machine_code,candidate.line_code,coalesce(candidate.source,'MANUAL'),jsonb_build_object('user_id',actor)) RETURNING * INTO row_data;
  PERFORM public.buymore_audit('SUBMIT','production_data',row_data.id::text,'Input produksi diajukan',NULL,to_jsonb(row_data));
  RETURN jsonb_build_object('saved',true,'record',to_jsonb(row_data)||jsonb_build_object('id',row_data.id::text));
END $fn$;

CREATE OR REPLACE FUNCTION public.buymore_review_production(p_id text,p_expected_version integer,p_decision text,p_reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(true); prior public.production_data%ROWTYPE; changed public.production_data%ROWTYPE;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('VERIFIED','REJECTED') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  IF length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'ALASAN_MAKS_2000'; END IF;
  IF p_decision='REJECTED' THEN p_reason:=public.buymore_reason(p_reason); END IF;
  SELECT * INTO prior FROM public.production_data WHERE id::text=p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DATA_NOT_FOUND'; END IF;
  IF NOT public.buymore_factory_access(prior.factory_code) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
  IF p_expected_version IS DISTINCT FROM prior.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF prior.verification_status NOT IN ('SUBMITTED','LEGACY') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF prior.factory_code IS NULL OR prior.product_master_code IS NULL OR prior.color_master_code IS NULL OR prior.shift_master_code IS NULL THEN
    RAISE EXCEPTION 'LEGACY_MAPPING_REQUIRED: gunakan Koreksi untuk menentukan Factory dan master yang benar';
  END IF;
  PERFORM set_config('buymore.operation',CASE p_decision WHEN 'VERIFIED' THEN 'VERIFY' ELSE 'REJECT' END,true);
  UPDATE public.production_data SET verification_status=p_decision,verified_by=actor,verified_at=clock_timestamp(),
    rejection_reason=CASE WHEN p_decision='REJECTED' THEN p_reason ELSE NULL END,version=prior.version+1,updated_at=clock_timestamp()
    WHERE id=prior.id RETURNING * INTO changed;
  PERFORM public.buymore_audit(CASE p_decision WHEN 'VERIFIED' THEN 'VERIFY' ELSE 'REJECT' END,'production_data',p_id,p_reason,to_jsonb(prior),to_jsonb(changed));
  RETURN to_jsonb(changed)||jsonb_build_object('id',changed.id::text);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_correct_production(p_id text,p_expected_version integer,p_changes jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(true); prior public.production_data%ROWTYPE; changed public.production_data%ROWTYPE;
  f text; p text; c text; s text; qty bigint;
BEGIN
  p_reason:=public.buymore_reason(p_reason);
  SELECT * INTO prior FROM public.production_data WHERE id::text=p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DATA_NOT_FOUND'; END IF;
  IF NOT public.buymore_factory_access(prior.factory_code) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
  IF p_expected_version IS DISTINCT FROM prior.version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF coalesce(p_changes->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
  qty:=(p_changes->>'quantity')::bigint; IF qty NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
  f:=public.buymore_master_code('FACTORY',p_changes->>'factory_code');
  IF NOT public.buymore_factory_access(f) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
  p:=public.buymore_master_code('PRODUCT',p_changes->>'product'); c:=public.buymore_master_code('COLOR',p_changes->>'color'); s:=public.buymore_master_code('SHIFT',p_changes->>'shift');
  IF coalesce(p_changes->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
  IF length(coalesce(p_changes->>'note',''))>4000 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;
  changed:=jsonb_populate_record(prior,jsonb_build_object('date',(p_changes->>'date')::date,'quantity',qty,'note',p_changes->>'note',
    'factory_code',f,'product_master_code',p,'color_master_code',c,'shift_master_code',s,
    'product',public.buymore_master_name('PRODUCT',p),'color',public.buymore_master_name('COLOR',c),'shift',public.buymore_master_name('SHIFT',s)));
  PERFORM set_config('buymore.operation','CORRECT',true);
  UPDATE public.production_data SET date=changed.date,quantity=qty,note=changed.note,product=changed.product,color=changed.color,shift=changed.shift,
    factory_code=f,product_master_code=p,color_master_code=c,shift_master_code=s,verification_status='SUBMITTED',verified_by=NULL,verified_at=NULL,
    rejection_reason=NULL,correction_reason=p_reason,version=prior.version+1,updated_at=clock_timestamp() WHERE id=prior.id RETURNING * INTO changed;
  PERFORM public.buymore_audit('CORRECT','production_data',p_id,p_reason,to_jsonb(prior),to_jsonb(changed));
  RETURN to_jsonb(changed)||jsonb_build_object('id',changed.id::text);
END $fn$;

CREATE OR REPLACE FUNCTION public.buymore_save_plan(p_payload jsonb,p_id text DEFAULT NULL,p_expected_version integer DEFAULT NULL,p_reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(true); prior public.production_targets%ROWTYPE; changed public.production_targets%ROWTYPE; f text;p text;c text;s text;qty bigint;
BEGIN
  IF p_id IS NOT NULL THEN
    p_reason:=public.buymore_reason(p_reason);
    SELECT * INTO prior FROM public.production_targets WHERE id::text=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DATA_NOT_FOUND'; END IF;
    IF NOT public.buymore_factory_access(prior.factory_code) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
    IF prior.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  END IF;
  PERFORM set_config('buymore.operation','PLAN_SAVE',true);
  -- Deactivation also works for an incomplete legacy plan, without fabricating dimensions.
  IF p_id IS NOT NULL AND p_payload->>'is_active'='false' THEN
    UPDATE public.production_targets SET is_active=false,version=prior.version+1,updated_at=clock_timestamp() WHERE id=prior.id RETURNING * INTO changed;
  ELSE
    IF coalesce(p_payload->>'target_quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
    qty:=(p_payload->>'target_quantity')::bigint; IF qty NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'QTY_POSITIVE_INTEGER_REQUIRED'; END IF;
    f:=public.buymore_master_code('FACTORY',p_payload->>'factory_code'); IF NOT public.buymore_factory_access(f) THEN RAISE EXCEPTION 'FACTORY_FORBIDDEN'; END IF;
    p:=public.buymore_master_code('PRODUCT',p_payload->>'product'); c:=public.buymore_master_code('COLOR',p_payload->>'color'); s:=public.buymore_master_code('SHIFT',p_payload->>'shift');
    IF coalesce(p_payload->>'target_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
    IF length(coalesce(p_payload->>'note',''))>4000 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;
    changed:=jsonb_populate_record(NULL::public.production_targets,jsonb_build_object('target_date',(p_payload->>'target_date')::date,
      'product',public.buymore_master_name('PRODUCT',p),'color',public.buymore_master_name('COLOR',c),'shift',public.buymore_master_name('SHIFT',s)));
    IF p_id IS NULL THEN
      INSERT INTO public.production_targets(target_date,product,color,shift,target_quantity,note,created_by,factory_code,product_master_code,color_master_code,shift_master_code,is_active,version)
      VALUES(changed.target_date,changed.product,changed.color,changed.shift,qty,p_payload->>'note',actor,f,p,c,s,true,1) RETURNING * INTO changed;
    ELSE
      UPDATE public.production_targets SET target_date=changed.target_date,product=changed.product,color=changed.color,shift=changed.shift,target_quantity=qty,
        note=p_payload->>'note',factory_code=f,product_master_code=p,color_master_code=c,shift_master_code=s,is_active=true,version=prior.version+1,updated_at=clock_timestamp()
        WHERE id=prior.id RETURNING * INTO changed;
    END IF;
  END IF;
  PERFORM public.buymore_audit('PLAN_SAVE','production_targets',changed.id::text,p_reason,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(prior) END,to_jsonb(changed));
  RETURN to_jsonb(changed)||jsonb_build_object('id',changed.id::text);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_save_master(p_payload jsonb,p_id text DEFAULT NULL,p_expected_version integer DEFAULT NULL,p_reason text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(true,true); prior public.master_items%ROWTYPE; changed public.master_items%ROWTYPE;
  cat text:=upper(btrim(p_payload->>'category')); code_value text:=btrim(p_payload->>'code'); name_value text:=btrim(p_payload->>'name');
BEGIN
  IF p_id IS NULL THEN code_value:=upper(code_value); END IF;
  IF cat NOT IN ('PRODUCT','COLOR','SHIFT','FACTORY') OR cat IS NULL THEN RAISE EXCEPTION 'INVALID_CATEGORY'; END IF;
  IF coalesce(length(code_value),0) NOT BETWEEN 1 AND 128 OR coalesce(length(name_value),0) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'CODE_NAME_REQUIRED'; END IF;
  IF jsonb_typeof(coalesce(p_payload->'metadata','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'INVALID_METADATA'; END IF;
  IF p_id IS NOT NULL THEN
    p_reason:=public.buymore_reason(p_reason);
    SELECT * INTO prior FROM public.master_items WHERE id::text=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DATA_NOT_FOUND'; END IF;
    IF prior.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF prior.code<>code_value OR prior.category<>cat THEN RAISE EXCEPTION 'MASTER_CODE_IMMUTABLE'; END IF;
  END IF;
  PERFORM set_config('buymore.operation','MASTER_SAVE',true);
  IF p_id IS NULL THEN
    INSERT INTO public.master_items(category,code,name,is_active,metadata,created_by,version)
    VALUES(cat,code_value,name_value,coalesce((p_payload->>'is_active')::boolean,true),coalesce(p_payload->'metadata','{}'::jsonb),actor,1) RETURNING * INTO changed;
  ELSE
    UPDATE public.master_items SET name=name_value,is_active=coalesce((p_payload->>'is_active')::boolean,true),metadata=coalesce(p_payload->'metadata',metadata),version=prior.version+1,updated_at=clock_timestamp()
      WHERE id=prior.id RETURNING * INTO changed;
  END IF;
  PERFORM public.buymore_audit('MASTER_SAVE','master_items',changed.id::text,p_reason,CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(prior) END,to_jsonb(changed));
  RETURN to_jsonb(changed)||jsonb_build_object('id',changed.id::text);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_set_user_access(p_user_id uuid,p_role text,p_is_active boolean,p_factories text[],p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE actor uuid:=public.buymore_require(true,true); prior public.profiles%ROWTYPE; changed public.profiles%ROWTYPE; code_value text; old_factories jsonb;
BEGIN
  p_reason:=public.buymore_reason(p_reason);
  IF p_role IS NULL OR p_role NOT IN ('admin','supervisor','operator') OR p_is_active IS NULL THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  -- Serialize all role changes, preventing concurrent loss of the last active admin.
  PERFORM pg_advisory_xact_lock(hashtextextended('buymore-user-access',0));
  SELECT * INTO prior FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF actor=p_user_id AND (p_role<>'admin' OR NOT p_is_active) THEN RAISE EXCEPTION 'ADMIN_CANNOT_DISABLE_OR_DEMOTE_SELF'; END IF;
  IF prior.role='admin' AND prior.is_active AND (p_role<>'admin' OR NOT p_is_active)
    AND (SELECT count(*) FROM public.profiles WHERE role='admin' AND is_active)<=1 THEN RAISE EXCEPTION 'LAST_ACTIVE_ADMIN_REQUIRED'; END IF;
  IF p_is_active AND p_role<>'admin' AND coalesce(cardinality(p_factories),0)=0 THEN RAISE EXCEPTION 'FACTORY_ASSIGNMENT_REQUIRED'; END IF;
  FOREACH code_value IN ARRAY coalesce(p_factories,ARRAY[]::text[]) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.master_items WHERE category='FACTORY' AND code=code_value AND is_active) THEN RAISE EXCEPTION 'FACTORY_INACTIVE'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(factory_code),'[]'::jsonb) INTO old_factories FROM public.buymore_user_factories WHERE user_id=p_user_id;
  PERFORM set_config('buymore.operation','USER_ACCESS',true);
  UPDATE public.profiles SET role=p_role,is_active=p_is_active,updated_at=clock_timestamp() WHERE id=p_user_id RETURNING * INTO changed;
  DELETE FROM public.buymore_user_factories WHERE user_id=p_user_id;
  INSERT INTO public.buymore_user_factories(user_id,factory_code,assigned_by) SELECT p_user_id,x,actor FROM (SELECT DISTINCT unnest(coalesce(p_factories,ARRAY[]::text[])) x) q;
  PERFORM public.buymore_audit('USER_ACCESS','profiles',p_user_id::text,p_reason,to_jsonb(prior)||jsonb_build_object('factory_codes',old_factories),to_jsonb(changed)||jsonb_build_object('factory_codes',p_factories));
  RETURN to_jsonb(changed);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_update_language(p_language text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.buymore_require();
  IF p_language IS NULL OR p_language NOT IN ('id','cn') THEN RAISE EXCEPTION 'INVALID_LANGUAGE'; END IF;
  -- This field-only update is separate from role mutations; the guard below recognizes it.
  PERFORM set_config('buymore.operation','LANGUAGE',true);
  UPDATE public.profiles SET language=p_language WHERE id=auth.uid();
END $fn$;

-- Shared server-side filtering; literal search, not interpolated SQL/PostgREST syntax.
CREATE OR REPLACE FUNCTION public.buymore_filtered_production(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.production_data LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE lower_bound public.production_data%ROWTYPE; upper_bound public.production_data%ROWTYPE;
BEGIN
  IF public.buymore_role() IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;
  IF jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'INVALID_FILTERS'; END IF;
  IF nullif(p_filters->>'start_date','') IS NOT NULL THEN PERFORM (p_filters->>'start_date')::date; END IF;
  IF nullif(p_filters->>'end_date','') IS NOT NULL THEN PERFORM (p_filters->>'end_date')::date; END IF;
  IF p_filters->>'start_date' > p_filters->>'end_date' THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  lower_bound:=jsonb_populate_record(NULL::public.production_data,jsonb_build_object('date',nullif(p_filters->>'start_date','')));
  upper_bound:=jsonb_populate_record(NULL::public.production_data,jsonb_build_object('date',nullif(p_filters->>'end_date','')));
  RETURN QUERY SELECT p.* FROM public.production_data p WHERE p.deleted_at IS NULL
    AND (nullif(p_filters->>'start_date','') IS NULL OR p.date>=lower_bound.date)
    AND (nullif(p_filters->>'end_date','') IS NULL OR p.date<=upper_bound.date)
    AND (nullif(p_filters->>'factory_code','') IS NULL OR p.factory_code=p_filters->>'factory_code')
    AND (nullif(p_filters->>'product','') IS NULL OR p.product_master_code=p_filters->>'product' OR p.product=p_filters->>'product')
    AND (nullif(p_filters->>'color','') IS NULL OR p.color_master_code=p_filters->>'color' OR p.color=p_filters->>'color')
    AND (nullif(p_filters->>'shift','') IS NULL OR p.shift_master_code=p_filters->>'shift' OR p.shift=p_filters->>'shift')
    AND (nullif(p_filters->>'status','') IS NULL OR p.verification_status=p_filters->>'status'
      OR (p_filters->>'status'='PENDING' AND p.verification_status IN ('LEGACY','SUBMITTED')))
    AND (nullif(p_filters->>'search','') IS NULL OR strpos(lower(concat_ws(' ',p.product,p.color,p.note,p.created_by,p.factory_code,p.shift,p.machine_code,p.line_code)),lower(p_filters->>'search'))>0);
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_production_page(p_filters jsonb DEFAULT '{}'::jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_max_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
  IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_PAGINATION'; END IF;
  WITH filtered AS MATERIALIZED(SELECT * FROM public.buymore_filtered_production(p_filters) p
      WHERE p_max_id IS NULL OR p.id<=(SELECT z.id FROM public.production_data z WHERE z.id::text=p_max_id)),
    page AS(SELECT * FROM filtered ORDER BY id DESC OFFSET p_offset LIMIT p_limit)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.id::text) ORDER BY p.id DESC) FROM page p),'[]'::jsonb),
    'count',(SELECT count(*) FROM filtered),'total_qty',(SELECT coalesce(sum(quantity),0) FROM filtered)) INTO result;
  RETURN result;
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_export_snapshot(p_filters jsonb DEFAULT '{}'::jsonb,p_max_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
  WITH selected AS MATERIALIZED(SELECT * FROM public.buymore_filtered_production(p_filters) p
    WHERE p_max_id IS NULL OR p.id<=(SELECT z.id FROM public.production_data z WHERE z.id::text=p_max_id)
    ORDER BY id DESC LIMIT 50001)
  SELECT jsonb_build_object('count',count(*),'max_id',(SELECT id::text FROM selected ORDER BY id DESC LIMIT 1),
    'fingerprint',md5(coalesce(string_agg(id::text||':'||version::text,',' ORDER BY id),''))) INTO result FROM selected;
  RETURN result;
END $fn$;

-- No wildcard targets: each active complete plan owns one exact five-dimensional key.
-- Daily/shift totals are SUMs of those plans, not additional overlapping target records.
CREATE OR REPLACE FUNCTION public.buymore_plan_rows(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(row_data jsonb,target_qty numeric,actual_qty numeric,complete boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE lower_bound public.production_targets%ROWTYPE; upper_bound public.production_targets%ROWTYPE;
BEGIN
  IF public.buymore_role() NOT IN ('admin','supervisor') OR public.buymore_role() IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;
  IF nullif(p_filters->>'start_date','') IS NOT NULL THEN PERFORM (p_filters->>'start_date')::date; END IF;
  IF nullif(p_filters->>'end_date','') IS NOT NULL THEN PERFORM (p_filters->>'end_date')::date; END IF;
  IF p_filters->>'start_date'>p_filters->>'end_date' THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  lower_bound:=jsonb_populate_record(NULL::public.production_targets,jsonb_build_object('target_date',nullif(p_filters->>'start_date','')));
  upper_bound:=jsonb_populate_record(NULL::public.production_targets,jsonb_build_object('target_date',nullif(p_filters->>'end_date','')));
  RETURN QUERY
  WITH plans AS MATERIALIZED(SELECT t.* FROM public.production_targets t
    WHERE (t.is_active OR p_filters->>'include_inactive'='true')
      AND (nullif(p_filters->>'start_date','') IS NULL OR t.target_date>=lower_bound.target_date)
      AND (nullif(p_filters->>'end_date','') IS NULL OR t.target_date<=upper_bound.target_date)
      AND (nullif(p_filters->>'factory_code','') IS NULL OR t.factory_code=p_filters->>'factory_code')
      AND (nullif(p_filters->>'product','') IS NULL OR t.product_master_code=p_filters->>'product' OR t.product=p_filters->>'product')
      AND (nullif(p_filters->>'color','') IS NULL OR t.color_master_code=p_filters->>'color' OR t.color=p_filters->>'color')
      AND (nullif(p_filters->>'shift','') IS NULL OR t.shift_master_code=p_filters->>'shift' OR t.shift=p_filters->>'shift')),
  matched AS(SELECT t.*,coalesce(a.qty,0) AS actual,
    (t.factory_code IS NOT NULL AND t.product_master_code IS NOT NULL AND t.color_master_code IS NOT NULL AND t.shift_master_code IS NOT NULL) AS mapped
    FROM plans t LEFT JOIN LATERAL(SELECT sum(p.quantity)::numeric AS qty FROM public.production_data p
      WHERE p.deleted_at IS NULL AND p.verification_status='VERIFIED' AND p.date=t.target_date
        AND p.factory_code=t.factory_code AND p.product_master_code=t.product_master_code
        AND p.color_master_code=t.color_master_code AND p.shift_master_code=t.shift_master_code) a ON true)
  SELECT (to_jsonb(m)-'actual'-'mapped') || jsonb_build_object('id',m.id::text,'actual_quantity',m.actual,'complete',m.mapped,
      'remaining_quantity',greatest(m.target_quantity-m.actual,0),'progress',CASE WHEN m.target_quantity>0 THEN round(m.actual/m.target_quantity*100,4) ELSE NULL END),
    CASE WHEN m.is_active AND m.mapped THEN m.target_quantity::numeric ELSE 0::numeric END,
    CASE WHEN m.is_active AND m.mapped THEN m.actual ELSE 0::numeric END,m.mapped
  FROM matched m;
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_plan_page(p_filters jsonb DEFAULT '{}'::jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
  IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_PAGINATION'; END IF;
  WITH items AS MATERIALIZED(SELECT * FROM public.buymore_plan_rows(p_filters)),
    page AS(SELECT row_data FROM items ORDER BY row_data->>'target_date' DESC,row_data->>'id' DESC OFFSET p_offset LIMIT p_limit),
    days AS(SELECT row_data->>'target_date' label,sum(target_qty) target,sum(actual_qty) actual FROM items GROUP BY 1),
    shifts AS(SELECT coalesce(row_data->>'shift_master_code',row_data->>'shift','-') label,sum(target_qty) target,sum(actual_qty) actual FROM items GROUP BY 1)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(row_data) FROM page),'[]'::jsonb),
    'count',(SELECT count(*) FROM items),'legacy_count',(SELECT count(*) FROM items WHERE NOT complete),
    'target',coalesce((SELECT sum(target_qty) FROM items),0),'actual',coalesce((SELECT sum(actual_qty) FROM items),0),
    'by_day',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY label DESC) FROM days d),'[]'::jsonb),
    'by_shift',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY label) FROM shifts s),'[]'::jsonb)) INTO result;
  RETURN result;
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_dashboard(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE result jsonb; plan_summary jsonb;
BEGIN
  IF public.buymore_role() NOT IN ('admin','supervisor') OR public.buymore_role() IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;
  plan_summary:=public.buymore_plan_page(p_filters-'status'-'search',0,10);
  WITH selected AS MATERIALIZED(SELECT * FROM public.buymore_filtered_production(p_filters-'status') WHERE verification_status<>'REJECTED'),
    all_time AS(SELECT coalesce(sum(quantity),0) qty FROM public.buymore_filtered_production(p_filters-'start_date'-'end_date'-'status') WHERE verification_status<>'REJECTED'),
    factories AS(SELECT coalesce(factory_code,'Belum dipetakan') label,sum(quantity) value FROM selected GROUP BY 1),
    products AS(SELECT coalesce(product_master_code,product) label,sum(quantity) value FROM selected GROUP BY 1),
    colors AS(SELECT coalesce(color_master_code,color,'-') label,sum(quantity) value FROM selected GROUP BY 1),
    shifts AS(SELECT coalesce(shift_master_code,shift) label,sum(quantity) value FROM selected GROUP BY 1)
  SELECT jsonb_build_object('total_all_time',(SELECT qty FROM all_time),'total',coalesce((SELECT sum(quantity) FROM selected),0),
    'verified',coalesce((SELECT sum(quantity) FROM selected WHERE verification_status='VERIFIED'),0),
    'count',(SELECT count(*) FROM selected),'plans',plan_summary,
    'by_factory',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY value DESC,label) FROM factories f),'[]'::jsonb),
    'by_product',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY value DESC,label) FROM (SELECT * FROM products ORDER BY value DESC,label LIMIT 100) p),'[]'::jsonb),
    'by_color',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY value DESC,label) FROM (SELECT * FROM colors ORDER BY value DESC,label LIMIT 100) c),'[]'::jsonb),
    'by_shift',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY value DESC,label) FROM shifts s),'[]'::jsonb)) INTO result;
  RETURN result;
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_log_session_event(p_event text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.buymore_require();
  IF p_event IS NULL OR p_event NOT IN ('SIGNED_IN','SIGNED_OUT','PASSWORD_RECOVERY','MFA_CHALLENGE_VERIFIED') THEN RAISE EXCEPTION 'INVALID_EVENT'; END IF;
  -- Application session event, NOT proof of a fresh authentication. Auth audit remains authoritative.
  PERFORM public.buymore_audit('SESSION_'||p_event,'profiles',auth.uid()::text,'Peristiwa sesi aplikasi',NULL,jsonb_build_object('aal',auth.jwt()->>'aal'));
END $fn$;
CREATE OR REPLACE FUNCTION public.buymore_admin_check() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN PERFORM public.buymore_require(true,true); RETURN true; END $fn$;

-- Grant only intentional API/read-policy entry points. Internal mutator helpers stay private.
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'buymore_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
    IF r.proname IN ('buymore_role','buymore_factory_access','buymore_filtered_production','buymore_plan_rows',
      'buymore_production_page','buymore_export_snapshot','buymore_plan_page','buymore_dashboard',
      'buymore_save_production','buymore_review_production','buymore_correct_production','buymore_save_plan',
      'buymore_save_master','buymore_set_user_access','buymore_update_language','buymore_log_session_event','buymore_admin_check') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature);
    END IF;
  END LOOP;
END $grants$;
DO $validate$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.conrelid::regclass AS tab,c.conname FROM pg_constraint c
    WHERE c.connamespace='public'::regnamespace AND NOT c.convalidated AND
      (c.conname LIKE 'buymore_%' OR (c.conrelid='public.master_items'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ~* '\mcategory\M') OR (c.conrelid IN ('public.production_data'::regclass,'public.production_targets'::regclass) AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%shift_master_code%'))
  LOOP EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I',r.tab,r.conname); END LOOP;
END $validate$;
NOTIFY pgrst,'reload schema';
COMMIT;
