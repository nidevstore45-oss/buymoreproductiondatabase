/** Source contract checks. They do not execute PostgreSQL or prove RLS behavior. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20260921000100_production_workflow.sql','utf8');
const main=readFileSync('main.tsx','utf8');
test('migration rejects unsupported pre-existing Factory models before modifying schema',()=>{
  assert.match(sql,/EXISTING_FACTORY_MODEL_REQUIRES_RECONCILIATION/);
});
test('pre-existing optimistic versions cannot be nullable or nonpositive',()=>{
  assert.match(sql,/VERSION_CONTRACT_MISMATCH/);
});
test('new nonlegacy production has complete canonical references enforced by constraint',()=>{
  assert.match(sql,/buymore_production_complete_check/);
  assert.match(sql,/VALIDATE CONSTRAINT/);
});
test('idempotent replay still rechecks current factory authorization',()=>{
  const body=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.buymore_save_production'),sql.indexOf('CREATE OR REPLACE FUNCTION public.buymore_review_production'));
  assert.match(body,/buymore_factory_access\(row_data\.factory_code\)/);
});
test('original dashboard and plan functions receive realtime data version',()=>{
  assert.match(main,/function AnalyticsPage\([^\n]*dataVersion=0/);
  assert.match(main,/function ProductionTargetsPage\([^\n]*dataVersion=0/);
  assert.match(main,/<ProductionTargetsPage[^\n]*dataVersion=\{productionRefresh\}/);
});
test('supervisors have an actual navigation action for their existing MFA page',()=>{
  assert.match(main,/id:'security',label:bi\('Keamanan Akun'/);
  assert.match(main,/activeTab === 'security' && <MfaManagement/);
  assert.match(main,/onNavigate=\{\(key,sub\)=>\{setActiveTab\(key\)/);
  const shell=readFileSync('src/ui/AppShell.tsx','utf8');
  assert.match(shell,/onClick=\{\(\)=>navigate\(item.id\)\}/);
});
