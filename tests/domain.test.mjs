import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const modulePath = new URL('../.test-build/domain.js', import.meta.url);
const available = existsSync(modulePath);
test('domain implementation is present', () => assert.ok(available, 'Missing production domain implementation'));
const d = available ? await import(modulePath.href) : {};
const domainTest = (name, fn) => test(name, { skip: !available }, fn);
domainTest('progress preserves 110 percent and surplus', () => {
  assert.deepEqual(d.planProgress(500,550), {target:500,actual:550,remaining:0,surplus:50,percent:110,barPercent:100});
});
domainTest('zero target has no fabricated percentage', () => assert.equal(d.planProgress(0,10).percent,null));
domainTest('quantity must be a positive safe integer, not silently rounded', () => {
  for (const value of ['', '0', '-1','1.2','1e3','NaN', '9007199254740992']) assert.throws(() => d.positiveQuantity(value));
  assert.equal(d.positiveQuantity('120'),120);
});
domainTest('Jakarta day boundary is independent of the device timezone', () => {
  assert.equal(d.jakartaDateKey(new Date('2026-09-16T17:00:00Z')),'2026-09-17');
  assert.equal(d.jakartaDateKey(new Date('2026-09-16T16:59:59Z')),'2026-09-16');
});
domainTest('7 and 30 days are inclusive rolling ranges, not calendar weeks', () => {
  assert.deepEqual(d.periodRange(7,'2026-09-21'),{start_date:'2026-09-15',end_date:'2026-09-21'});
  assert.deepEqual(d.periodRange(30,'2026-09-21'),{start_date:'2026-08-23',end_date:'2026-09-21'});
});
domainTest('invalid calendar dates and reversed ranges fail', () => {
  for (const date of ['2026-02-30','2026-13-01','2026-00-01','17/09/2026']) assert.throws(() => d.validateDate(date));
  assert.throws(() => d.validateFilters({start_date:'2026-09-22',end_date:'2026-09-21'}));
});
domainTest('exact plan keys isolate factory, shift and color', () => {
  const a={date:'2026-09-17',factory_code:'F1',product_master_code:'105',color_master_code:'KHAKI',shift_master_code:'SIANG'};
  for(const key of ['factory_code','color_master_code','shift_master_code']) assert.notEqual(d.planKey(a),d.planKey({...a,[key]:'OTHER'}));
});
domainTest('only acknowledged queue items are removed, concurrent additions survive', () => {
  const a={id:'a',payload:{quantity:1},attempts:0}; const b={id:'b',payload:{quantity:2},attempts:0};
  const result=d.reconcileQueue([a,b],[{id:'a',ok:true}]);
  assert.deepEqual(result,[b]);
  assert.equal(d.reconcileQueue([a],[{id:'a',ok:false,error:'23505 unrelated constraint'}])[0].last_error,'23505 unrelated constraint');
});
domainTest('an unknown or inactive role gets no elevated UI permission', () => {
  assert.equal(d.canManage({role:'supervisor',is_active:false}),false);
  assert.equal(d.canManage(null),false);
  assert.equal(d.canManage({role:'supervisor',is_active:true}),true);
  assert.equal(d.canAdmin({role:'operator',is_active:true}),false);
});
domainTest('export text does not become an Excel formula', () => {
  for (const value of ['=HYPERLINK("x")','+1','-1','@SUM(A1)','\t=1']) assert.ok(d.excelText(value).startsWith("'"));
  assert.equal(d.excelText('KHAKI'),'KHAKI');
});
domainTest('filter search remains a literal string and limit is bounded', () => {
  const filter=d.validateFilters({search:'105,OR(status.eq.VERIFIED)',factory_code:'F1'});
  assert.equal(filter.search,'105,OR(status.eq.VERIFIED)');
  assert.equal(d.pageBounds(2,50).offset,100);
  assert.throws(() => d.pageBounds(-1,50)); assert.throws(() => d.pageBounds(0,10000));
});
domainTest('master resolution prefers a canonical code over another item name',()=>{
  assert.equal(d.resolveMasterCode([{category:'PRODUCT',code:'105',name:'Bag A',is_active:true},{category:'PRODUCT',code:'159',name:'105',is_active:true}],'PRODUCT','105'),'105');
});
domainTest('inactive canonical codes cannot be reinterpreted as another active item name',()=>{
  assert.throws(()=>d.resolveMasterCode([{category:'COLOR',code:'KHK',name:'Khaki',is_active:false},{category:'COLOR',code:'OTHER',name:'KHK',is_active:true}],'COLOR','KHK'),/nonaktif/);
});
domainTest('ambiguous master names must not silently pick an identity',()=>{
  assert.throws(()=>d.resolveMasterCode([{category:'SHIFT',code:'A',name:'Siang',is_active:true},{category:'SHIFT',code:'B',name:'Siang',is_active:true}],'SHIFT','Siang'),/ambigu/);
});
domainTest('legacy mixed-case master codes are preserved, not renamed',()=>{
  assert.equal(d.resolveMasterCode([{category:'PRODUCT',code:'OldCode',name:'Old Bag',is_active:true}],'PRODUCT','oldcode'),'OldCode');
});
