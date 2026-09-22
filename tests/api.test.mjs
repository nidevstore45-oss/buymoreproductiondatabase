/** Unit tests for the real API adapter's control flow, not a simulated application database. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const available=existsSync('.test-build/api-core.js');
let createProductionApi;
if(available) ({createProductionApi}=await import('../.test-build/api-core.js'));
test('API core is independently testable without a fallback database',()=>assert.ok(available,'API core is missing'));
const unit=(name,fn)=>test(name,{skip:!available},fn);
const ok=data=>({data,error:null});
unit('invalid date range is rejected before any request',async()=>{
  let called=false;const api=createProductionApi(async()=>{called=true;return ok({});});
  await assert.rejects(()=>api.page({start_date:'2026-09-21',end_date:'2026-09-20'}),/Tanggal/);assert.equal(called,false);
});
unit('filters and pagination are sent to the server, with literal search intact',async()=>{
  let request;const api=createProductionApi(async(name,args)=>{request={name,args};return ok({rows:[],count:0,total_qty:0});});
  await api.page({factory_code:'F1',product:'105',color:'KHAKI',shift:'SIANG',search:"100% (red), O'Neil"},2,50);
  assert.equal(request.name,'buymore_production_page');assert.equal(request.args.p_offset,100);assert.equal(request.args.p_limit,50);
  assert.equal(request.args.p_filters.search,"100% (red), O'Neil");assert.equal(request.args.p_filters.factory_code,'F1');
});
unit('server save error never becomes a success acknowledgement',async()=>{
  const api=createProductionApi(async()=>({data:null,error:{message:'permission denied',code:'42501'}}));
  await assert.rejects(()=>api.submit({quantity:100}),/permission denied/);
});
unit('missing save acknowledgement is rejected',async()=>{
  const api=createProductionApi(async()=>ok({saved:false,record:{id:'1'}}));
  await assert.rejects(()=>api.submit({quantity:100}),/belum dikonfirmasi/);
});
unit('fractional quantity cannot be silently rounded by the submit adapter',async()=>{
  let calls=0;const api=createProductionApi(async()=>{calls++;return ok({saved:true,record:{id:'1'}});});
  await assert.rejects(()=>api.submit({quantity:'1.5'}),/bilangan bulat/);assert.equal(calls,0);
});
unit('rejection reason is required before transport',()=>{
  const api=createProductionApi(async()=>{throw new Error('must not be called');});
  assert.throws(()=>api.review({id:'4',version:3},'REJECTED',' '),/Alasan/);
});
unit('correction transmits expected version and does not mutate the source row optimistically',async()=>{
  const row={id:'4',version:3,quantity:100};let args;
  const api=createProductionApi(async(_name,value)=>{args=value;return ok({id:'4',version:4,quantity:120});});
  await api.correct(row,{quantity:120},'Salah jumlah');assert.equal(args.p_expected_version,3);assert.equal(args.p_reason,'Salah jumlah');assert.equal(row.quantity,100);
});
unit('full export retrieves all 1,250 filtered rows in bounded pages',async()=>{
  const offsets=[];const api=createProductionApi(async(name,args)=>{
    if(name==='buymore_export_snapshot')return ok({count:1250,max_id:'1250',fingerprint:'stable'});
    offsets.push(args.p_offset);assert.equal(args.p_limit,500);assert.equal(args.p_max_id,'1250');
    return ok({count:1250,total_qty:1250,rows:Array.from({length:Math.min(500,1250-args.p_offset)},(_,i)=>({id:String(args.p_offset+i+1),quantity:1}))});
  });
  const rows=await api.exportRows({factory_code:'F1'});assert.equal(rows.length,1250);assert.deepEqual(offsets,[0,500,1000]);
});
unit('changed snapshot aborts export instead of returning an inconsistent file',async()=>{
  let snapshots=0;const api=createProductionApi(async name=>name==='buymore_export_snapshot'?ok({count:1,max_id:'1',fingerprint:String(++snapshots)}):ok({count:1,total_qty:1,rows:[{id:'1'}]}));
  await assert.rejects(()=>api.exportRows({}),/Data berubah/);
});
unit('oversized export must narrow filters instead of silently truncating',async()=>{
  const api=createProductionApi(async name=>{assert.equal(name,'buymore_export_snapshot');return ok({count:50001,max_id:'50001',fingerprint:'x'});});
  await assert.rejects(()=>api.exportRows({}),/Persempit filter/);
});
unit('duplicate rows abort export',async()=>{
  const api=createProductionApi(async name=>name==='buymore_export_snapshot'?ok({count:2,max_id:'2',fingerprint:'stable'}):ok({count:2,total_qty:2,rows:[{id:'1'},{id:'1'}]}));
  await assert.rejects(()=>api.exportRows({}),/Data berubah/);
});
unit('empty export is explicit rather than generating a dummy data row',async()=>{
  const api=createProductionApi(async()=>ok({count:0,max_id:null,fingerprint:'empty'}));assert.deepEqual(await api.exportRows({}),[]);
});
unit('verification rejects a null acknowledgement instead of reporting success',async()=>{
  const api=createProductionApi(async()=>ok(null));
  await assert.rejects(()=>api.review({id:'4',version:3},'VERIFIED'),/Respons perubahan/);
});
unit('malformed export snapshot is not treated as an empty database',async()=>{
  const api=createProductionApi(async()=>ok({}));
  await assert.rejects(()=>api.exportRows({}),/snapshot/i);
});
unit('negative or fractional export counts are rejected',async()=>{
  for(const count of [-1,0.5]){
    const api=createProductionApi(async()=>ok({count,max_id:'1',fingerprint:'x'}));
    await assert.rejects(()=>api.exportRows({}),/snapshot/i);
  }
});
