import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const path = 'supabase/migrations/20260921000100_production_workflow.sql';
test('migration uses the existing production and master tables', () => {
  assert.ok(existsSync(path), 'Workflow migration is missing');
  const sql=readFileSync(path,'utf8');
  assert.match(sql,/alter table public\.production_data/i);
  assert.match(sql,/alter table public\.production_targets/i);
  assert.doesNotMatch(sql,/create table(?: if not exists)? public\.(production_data|production_targets|factories|products|colors|shifts)\b/i);
  assert.doesNotMatch(sql,/drop\s+(table|database)/i);
});
test('read and mutation contracts exist with version and scope protection', () => {
  assert.ok(existsSync(path), 'Workflow migration is missing');
  const sql=readFileSync(path,'utf8');
  for (const name of ['buymore_production_page','buymore_dashboard','buymore_plan_page','buymore_save_production','buymore_review_production','buymore_correct_production','buymore_save_plan','buymore_save_master','buymore_set_user_access'])
    assert.match(sql,new RegExp(`function public\\.${name}\\(`,'i'), name);
  for(const term of ['VERSION_CONFLICT','FOR UPDATE','security invoker','set search_path = \'\'','revoke all','enable row level security'])
    assert.ok(sql.toLowerCase().includes(term.toLowerCase()),term);
});
test('anonymous users cannot execute internal migration helpers',()=>{
  const sql=readFileSync(path,'utf8');
  assert.match(sql,/REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/IF r\.proname IN/);
  const allowlist=sql.slice(sql.indexOf('IF r.proname IN'),sql.indexOf('THEN',sql.indexOf('IF r.proname IN')));
  for(const name of ['buymore_audit','buymore_write_guard','buymore_require','buymore_master_code'])assert.ok(!allowlist.includes(`'${name}'`));
});
test('no forbidden ranking or time-series analysis remains in application sources',()=>{
  const main=readFileSync('main.tsx','utf8');
  const reports=readFileSync('legacy/report-runner.ts','utf8');
  assert.doesNotMatch(main,/AnalyticsLineChart|trendSeries|bestOperator|operatorSeries/);
  assert.doesNotMatch(reports,/top_operators|topOperators|operators\.set/);
});
test('profile changes and pending legacy records are guarded, not implicitly trusted',()=>{
  const sql=readFileSync(path,'utf8');
  assert.match(sql,/NEW\.role:='operator'; NEW\.is_active:=false/);
  assert.match(sql,/PROFILE_NOT_FOUND/);
  assert.match(sql,/DEFAULT 'LEGACY'/);
  assert.match(sql,/verification_status='SUBMITTED',verified_by=NULL/);
});
