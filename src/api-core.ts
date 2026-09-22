import { MAX_EXPORT_ROWS, pageBounds, positiveQuantity, requiredReason, validateFilters, type ProductionFilters } from './domain.js';
export interface ProductionRow {
  id: string; date: string; time: string; product: string; color: string; shift: string;
  quantity: number; note: string | null; created_by: string; created_by_id: string | null;
  factory_code: string | null; product_master_code?: string | null; color_master_code?: string | null;
  shift_master_code?: string | null; verification_status: string; version: number;
  rejection_reason?: string | null; correction_reason?: string | null; work_order_id?: string;
  batch_id?: string; machine_code?: string; line_code?: string; source?: string;
  [key: string]: unknown;
}
export interface MasterRow { id: string; category: string; code: string; name: string; is_active: boolean; version: number; metadata: Record<string,unknown> }
export interface PlanRow {
  id: string; target_date: string; product: string; color: string; shift: string;
  factory_code: string | null; product_master_code: string | null; color_master_code: string | null;
  shift_master_code: string | null; target_quantity: number; actual_quantity: number;
  remaining_quantity: number; is_active: boolean; complete: boolean; progress: number | null;
  version: number; note: string | null;
}
export interface ProductionPage { rows: ProductionRow[]; count: number; total_qty: number }
export interface PlanGroup { label: string; target: number; actual: number }
export interface PlanPage { rows: PlanRow[]; count: number; legacy_count: number; target: number; actual: number; by_day: PlanGroup[]; by_shift: PlanGroup[] }
export interface SeriesItem { label: string; value: number }
export interface Dashboard { total: number; total_all_time: number; verified: number; count: number; plans: PlanPage; by_factory: SeriesItem[]; by_product: SeriesItem[]; by_color: SeriesItem[]; by_shift: SeriesItem[] }
export interface RpcResult { data: unknown; error: { message: string; code?: string } | null }
export type RpcTransport = (name: string, args: Record<string,unknown>) => PromiseLike<RpcResult>;
/** Injectable transport is a unit-test boundary, not a runtime fallback or alternate database. */
export function createProductionApi(transport: RpcTransport) {
function assertObject(value: unknown): asserts value is Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respons Supabase tidak sesuai kontrak. Periksa migration.');
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const {data,error} = await transport(name,args);
  if(error) throw new Error(`${error.message}${error.code === 'PGRST202' ? ' Jalankan migration versi aplikasi ini terlebih dahulu.' : ''}`);
  return data as T;
}
async function mutate<T>(name:string,args:Record<string,unknown>):Promise<T> {
  const result=await rpc<unknown>(name,args);
  if(!result || typeof result!=='object' || Array.isArray(result) ||
     !('id' in result) || !['string','number'].includes(typeof result.id) || !String(result.id))
    throw new Error('Respons perubahan belum dikonfirmasi oleh Supabase. Muat ulang sebelum mencoba kembali.');
  return result as T;
}
function pageArgs(filters: ProductionFilters,page: number,size:number) {
  const bounds=pageBounds(page,size);
  return {p_filters:validateFilters(filters),p_offset:bounds.offset,p_limit:bounds.limit};
}
const productionApi = {
  async page(filters: ProductionFilters={},page=0,size=50,maxId?:string):Promise<ProductionPage> {
    const data=await rpc<ProductionPage>('buymore_production_page',{...pageArgs(filters,page,size),p_max_id:maxId??null});
    assertObject(data);
    if(!Array.isArray(data.rows) || typeof data.count!=='number') throw new Error('Respons pagination tidak valid.');
    return data;
  },
  async dashboard(filters: ProductionFilters):Promise<Dashboard> {
    const data=await rpc<Dashboard>('buymore_dashboard',{p_filters:validateFilters(filters)});
    assertObject(data); if(!data.plans || !Array.isArray(data.by_factory)) throw new Error('Respons dashboard tidak valid.');
    return data;
  },
  async plans(filters: ProductionFilters={},page=0,size=50):Promise<PlanPage> {
    const data=await rpc<PlanPage>('buymore_plan_page',pageArgs(filters,page,size));
    assertObject(data); if(!Array.isArray(data.rows)) throw new Error('Respons Production Plan tidak valid.');
    return data;
  },
  async submit(payload:Record<string,unknown>):Promise<ProductionRow> {
    positiveQuantity(payload.quantity);
    const data=await rpc<{saved:boolean;record:ProductionRow}>('buymore_save_production',{p_payload:payload});
    if(data?.saved!==true || !data.record?.id) throw new Error('Penyimpanan belum dikonfirmasi oleh Supabase.');
    return data.record;
  },
  review(row:ProductionRow,decision:'VERIFIED'|'REJECTED',reason='') {
    return mutate<ProductionRow>('buymore_review_production',{p_id:String(row.id),p_expected_version:row.version,
      p_decision:decision,p_reason:decision==='REJECTED'?requiredReason(reason):reason});
  },
  correct(row:ProductionRow,changes:Record<string,unknown>,reason:string) {
    positiveQuantity(changes.quantity);
    return mutate<ProductionRow>('buymore_correct_production',{p_id:String(row.id),p_expected_version:row.version,p_changes:changes,p_reason:requiredReason(reason)});
  },
  savePlan(payload:Record<string,unknown>,existing?:{id:string;version:number}|null,reason='') {
    if(payload.is_active!==false) positiveQuantity(payload.target_quantity);
    return mutate<PlanRow>('buymore_save_plan',{p_payload:payload,p_id:existing?.id??null,p_expected_version:existing?.version??null,p_reason:existing?requiredReason(reason):reason});
  },
  saveMaster(payload:Record<string,unknown>,existing?:{id:string;version:number}|null,reason='') {
    return mutate<MasterRow>('buymore_save_master',{p_payload:payload,p_id:existing?.id??null,p_expected_version:existing?.version??null,p_reason:existing?requiredReason(reason):reason});
  },
  setUserAccess(id:string,role:string,active:boolean,factories:string[],reason:string) {
    return mutate('buymore_set_user_access',{p_user_id:id,p_role:role,p_is_active:active,p_factories:factories,p_reason:requiredReason(reason)});
  },
  async exportRows(filters:ProductionFilters,onProgress?:(loaded:number,total:number)=>void):Promise<ProductionRow[]> {
    const p_filters=validateFilters(filters);
    type Snapshot={count:number;max_id:string|null;fingerprint:string};
    function validateSnapshot(value:unknown):asserts value is Snapshot {
      if(!value || typeof value!=='object' || !('count' in value) ||
        !Number.isSafeInteger(value.count) || Number(value.count)<0 ||
        !('fingerprint' in value) || typeof value.fingerprint!=='string' || !value.fingerprint ||
        !('max_id' in value) || (Number(value.count)>0 && (typeof value.max_id!=='string' || !value.max_id)))
        throw new Error('Respons snapshot export tidak valid. File tidak dibuat.');
    }
    const initial=await rpc<Snapshot>('buymore_export_snapshot',{p_filters,p_max_id:null});
    validateSnapshot(initial);
    if(initial.count>MAX_EXPORT_ROWS) throw new Error(`Export dibatasi ${MAX_EXPORT_ROWS.toLocaleString('id-ID')} baris. Persempit filter tanggal.`);
    if(!initial.count || !initial.max_id) return [];
    const rows:ProductionRow[]=[];
    for(let page=0;rows.length<initial.count;page++) {
      const batch=await productionApi.page(filters,page,500,initial.max_id);
      if(!batch.rows.length) throw new Error('Data berubah selama export. Ulangi export untuk hasil lengkap.');
      rows.push(...batch.rows);
      onProgress?.(rows.length,initial.count);
    }
    const final=await rpc<Snapshot>('buymore_export_snapshot',{p_filters,p_max_id:initial.max_id});
    validateSnapshot(final);
    if(initial.fingerprint!==final.fingerprint || initial.count!==final.count || rows.length!==initial.count || new Set(rows.map(r=>r.id)).size!==rows.length)
      throw new Error('Data berubah selama export. File tidak dibuat; ulangi agar hasil konsisten.');
    return rows;
  },
};

return productionApi;
}
