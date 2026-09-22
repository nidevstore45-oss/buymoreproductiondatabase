import {supabase} from './supabase';
import {createProductionApi, type MasterRow} from './api-core';
export type {ProductionRow, MasterRow, PlanRow, ProductionPage, PlanPage, PlanGroup, Dashboard, SeriesItem} from './api-core';
export async function loadMasters(): Promise<MasterRow[]> {
  const output: MasterRow[]=[];
  // Masters are bounded reference data, never a download of production transactions.
  for(let start=0;start<5000;start+=500) {
    const {data,error}=await supabase.from('master_items').select('*').order('category').order('code').range(start,start+499);
    if(error) throw new Error(error.message);
    output.push(...(data??[]).map(row=>({...row,id:String(row.id),version:Number(row.version??1)} as MasterRow)));
    if(!data || data.length<500) return output;
  }
  throw new Error('Master melebihi batas 5.000 item. Gunakan pencarian master di database sebelum memperbesar batas selector.');
}
export async function loadFactoryAccess(userId: string): Promise<string[]> {
  const {data,error}=await supabase.from('buymore_user_factories').select('factory_code').eq('user_id',userId).order('factory_code');
  if(error) throw new Error(error.message);
  return (data??[]).map(row=>String(row.factory_code));
}

export const productionApi=createProductionApi((name,args)=>supabase.rpc(name,args));
