/** Pure business rules shared by the existing UI and its regression tests. */
export type ProductionStatus = 'LEGACY' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export type CoreRole = 'admin' | 'supervisor' | 'operator';
export interface AccessProfile { role: string; is_active: boolean }
export interface ProductionFilters {
  start_date?: string; end_date?: string; factory_code?: string;
  product?: string; color?: string; shift?: string; status?: string; search?: string;
  include_inactive?: boolean;
}
export interface QueueItem {
  id: string; payload: Record<string, unknown>; attempts?: number;
  queued_at?: string; last_error?: string;
}
export interface QueueResult { id: string; ok: boolean; error?: string }
export const MAX_EXPORT_ROWS = 50_000;
export function positiveQuantity(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new Error('Qty harus berupa bilangan bulat positif.');
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2_147_483_647)
    throw new Error('Qty harus antara 1 dan 2.147.483.647.');
  return number;
}
export function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Format tanggal harus YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Tanggal tidak valid.');
  return value;
}
export function jakartaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function periodRange(days: number, end = jakartaDateKey()): Required<Pick<ProductionFilters, 'start_date' | 'end_date'>> {
  validateDate(end);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('Rentang hari tidak valid.');
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start_date: start.toISOString().slice(0, 10), end_date: end };
}
export function validateFilters(input: ProductionFilters = {}): ProductionFilters {
  const result: ProductionFilters = {};
  for (const key of ['start_date','end_date','factory_code','product','color','shift','status','search'] as const) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'string') throw new Error('Filter harus berupa teks.');
    const clean = value?.trim();
    if (clean) {
      if (clean.length > (key === 'search' ? 200 : 128)) throw new Error('Filter terlalu panjang.');
      result[key] = clean;
    }
  }
  if (result.start_date) validateDate(result.start_date);
  if (result.end_date) validateDate(result.end_date);
  if (result.start_date && result.end_date && result.start_date > result.end_date)
    throw new Error('Tanggal mulai tidak boleh melewati tanggal akhir.');
  if (result.status && !['LEGACY','SUBMITTED','VERIFIED','REJECTED','PENDING'].includes(result.status))
    throw new Error('Status filter tidak valid.');
  if (input.include_inactive === true) result.include_inactive = true;
  return result;
}
export function pageBounds(page: number, size = 50): { offset: number; limit: number } {
  if (!Number.isSafeInteger(page) || page < 0 || page > 1_000_000 ||
      !Number.isInteger(size) || size < 1 || size > 1000)
    throw new Error('Pagination tidak valid.');
  return { offset: page * size, limit: size };
}
export function planProgress(target: number, actual: number) {
  if (![target,actual].every(Number.isFinite) || target < 0 || actual < 0)
    throw new Error('Target dan actual harus berupa angka nonnegatif.');
  const percent = target > 0 ? Math.round((actual / target) * 1_000_000) / 10_000 : null;
  return { target, actual, remaining: Math.max(target - actual, 0),
    surplus: Math.max(actual - target, 0), percent, barPercent: Math.min(percent ?? 0, 100) };
}
export function planKey(row: Record<string, unknown>): string {
  return JSON.stringify(['date','factory_code','product_master_code','color_master_code','shift_master_code']
    .map(key => String(row[key] ?? '').trim().toUpperCase()));
}
export function canManage(profile?: AccessProfile | null): boolean {
  return Boolean(profile?.is_active && ['admin','supervisor'].includes(profile.role));
}
export function canAdmin(profile?: AccessProfile | null): boolean {
  return Boolean(profile?.is_active && profile.role === 'admin');
}
export function reconcileQueue(current: QueueItem[], results: QueueResult[]): QueueItem[] {
  const byId = new Map(results.map(item => [item.id,item]));
  return current.flatMap(item => {
    const result = byId.get(item.id);
    if (!result) return [item];
    if (result.ok) return [];
    return [{...item, attempts:(item.attempts ?? 0)+1, last_error:result.error || 'Penyimpanan belum dikonfirmasi.'}];
  });
}
export function excelText(value: unknown): string {
  const text = String(value ?? '');
  return /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
}
export function requiredReason(value: unknown): string {
  const reason = String(value ?? '').trim();
  if (!reason || reason.length > 2000) throw new Error('Alasan wajib diisi, maksimal 2.000 karakter.');
  return reason;
}
/** Convenience lookup for the existing duplicate confirmation. SQL repeats authoritative validation. */
export function resolveMasterCode(items: ReadonlyArray<{category:string;code:string;name:string;is_active:boolean}>,category:string,value:string):string {
  const text=value.trim().toUpperCase();
  const codes=items.filter(item=>item.category===category&&item.code.toUpperCase()===text);
  if(codes.length===1){if(!codes[0].is_active)throw new Error(`Master ${category} nonaktif.`);return codes[0].code;}
  if(codes.length>1)throw new Error(`Kode master ${category} ambigu.`);
  const names=items.filter(item=>item.category===category&&item.is_active&&item.name.toUpperCase()===text);
  if(names.length!==1)throw new Error(`Master ${category} tidak ditemukan atau ambigu. Pilih master aktif.`);
  return names[0].code;
}
