import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Schedule = {
  id: string;
  name: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  local_time: string;
  weekday: number | null;
  month_day: number | null;
  timezone: string;
  channel: "ARCHIVE" | "EMAIL" | "WEBHOOK" | "TELEGRAM" | "WHATSAPP";
  recipient: string | null;
  webhook_url: string | null;
  filters: Record<string, unknown> | null;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});


function decodeJwtPayload(authorization: string): Record<string, unknown> {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const raw = token.split(".")[1] || "";
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch { return {}; }
}

const htmlEscape = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function jakartaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return jakartaDateKey(date);
}

function periodFor(schedule: Schedule): { start: string; end: string } {
  const end = jakartaDateKey();
  if (schedule.frequency === "WEEKLY") return { start: addDays(end, -6), end };
  if (schedule.frequency === "MONTHLY") return { start: `${end.slice(0, 7)}-01`, end };
  return { start: end, end };
}

function nextRunFor(schedule: Schedule, from = new Date()): string {
  const time = String(schedule.local_time || "17:00:00").slice(0, 5);
  const today = jakartaDateKey(from);
  const at = (dateKey: string) => new Date(`${dateKey}T${time}:00+07:00`);
  if (schedule.frequency === "DAILY") {
    const candidate = at(today);
    return (candidate > from ? candidate : at(addDays(today, 1))).toISOString();
  }
  if (schedule.frequency === "WEEKLY") {
    const target = Number.isInteger(schedule.weekday) ? Number(schedule.weekday) : 1;
    for (let offset = 0; offset <= 7; offset += 1) {
      const key = addDays(today, offset);
      const candidate = at(key);
      const weekday = new Date(`${key}T12:00:00+07:00`).getUTCDay();
      if (weekday === target && candidate > from) return candidate.toISOString();
    }
  }
  const desiredDay = Math.min(Math.max(Number(schedule.month_day || 1), 1), 28);
  const current = new Date(`${today}T12:00:00+07:00`);
  for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth() + monthOffset;
    const candidateDate = new Date(Date.UTC(year, month, desiredDay, 5, 0, 0));
    const key = jakartaDateKey(candidateDate);
    const candidate = at(key);
    if (candidate > from) return candidate.toISOString();
  }
  return at(addDays(today, 1)).toISOString();
}

async function fetchAll(client: any, table: string, select: string, apply: (query: any) => any): Promise<any[]> {
  const pageSize = 1000;
  const output: any[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(select).range(from, from + pageSize - 1);
    query = apply(query);
    const { data, error } = await query;
    if (error) throw error;
    output.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return output;
}

function buildSummary(production: any[], quality: any[], targets: any[]) {
  const totalQuantity = production.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const totalTarget = targets.reduce((sum, row) => sum + Number(row.target_quantity || 0), 0);
  const inspected = quality.reduce((sum, row) => sum + Number(row.inspected_quantity || 0), 0);
  const good = quality.reduce((sum, row) => sum + Number(row.good_quantity || 0), 0);
  const reject = quality.reduce((sum, row) => sum + Number(row.reject_quantity || 0), 0);
  const rework = quality.reduce((sum, row) => sum + Number(row.rework_quantity || 0), 0);
  const products = new Map<string, number>();
  for (const row of production) {
    const qty = Number(row.quantity || 0);
    const product = String(row.product || "-");
    products.set(product, (products.get(product) || 0) + qty);
  }
  const topProducts = [...products.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  return {
    total_quantity: totalQuantity,
    total_records: production.length,
    total_target: totalTarget,
    achievement_percent: totalTarget ? Number(((totalQuantity / totalTarget) * 100).toFixed(2)) : 0,
    inspected_quantity: inspected,
    good_quantity: good,
    reject_quantity: reject,
    rework_quantity: rework,
    yield_rate: inspected ? Number(((good / inspected) * 100).toFixed(2)) : 0,
    reject_rate: inspected ? Number(((reject / inspected) * 100).toFixed(2)) : 0,
    top_products: topProducts,
  };
}

function reportHtml(schedule: Schedule, period: { start: string; end: string }, summary: any): string {
  const productRows = summary.top_products.map((item: any, index: number) => `<tr><td>${index + 1}</td><td>${htmlEscape(item.label)}</td><td style="text-align:right">${Number(item.value).toLocaleString("id-ID")}</td></tr>`).join("");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a"><h1>${htmlEscape(schedule.name)}</h1><p>Periode: <b>${period.start}</b> sampai <b>${period.end}</b> (Asia/Jakarta)</p><table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse"><tr><td>Total produksi</td><td><b>${summary.total_quantity.toLocaleString("id-ID")} Pcs</b></td></tr><tr><td>Target</td><td>${summary.total_target.toLocaleString("id-ID")} Pcs</td></tr><tr><td>Pencapaian</td><td>${summary.achievement_percent}%</td></tr><tr><td>Yield</td><td>${summary.yield_rate}%</td></tr><tr><td>Reject</td><td>${summary.reject_quantity.toLocaleString("id-ID")} (${summary.reject_rate}%)</td></tr><tr><td>Rework</td><td>${summary.rework_quantity.toLocaleString("id-ID")}</td></tr></table><h2>Top Produk</h2><table cellpadding="7" cellspacing="0" border="1" style="border-collapse:collapse"><thead><tr><th>#</th><th>Produk</th><th>Qty</th></tr></thead><tbody>${productRows}</tbody></table><p style="color:#64748b;font-size:12px">BUYMORE Production System • Dibuat otomatis</p></body></html>`;
}

async function deliver(schedule: Schedule, subject: string, html: string, text: string): Promise<string> {
  if (schedule.channel === "ARCHIVE") return "ARCHIVED_ONLY";
  if (schedule.channel === "EMAIL") {
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("REPORT_FROM_EMAIL") || "BUYMORE Reports <onboarding@resend.dev>";
    if (!key || !schedule.recipient) throw new Error("RESEND_API_KEY atau recipient belum dikonfigurasi.");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [schedule.recipient], subject, html }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`Email provider ${response.status}: ${body.slice(0, 500)}`);
    return body.slice(0, 1000);
  }
  if (schedule.channel === "TELEGRAM" && !schedule.webhook_url) {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token || !schedule.recipient) throw new Error("TELEGRAM_BOT_TOKEN atau chat ID belum dikonfigurasi.");
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: schedule.recipient, text }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`Telegram ${response.status}: ${body.slice(0, 500)}`);
    return body.slice(0, 1000);
  }
  if (!schedule.webhook_url) throw new Error(`webhook_url wajib untuk channel ${schedule.channel}.`);
  const response = await fetch(schedule.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: schedule.channel, recipient: schedule.recipient, subject, text, html }) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Webhook ${response.status}: ${body.slice(0, 500)}`);
  return body.slice(0, 1000);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) return jsonResponse({ error: "Server secrets belum lengkap." }, 500);
    const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json().catch(() => ({}));
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedCronSecret = Deno.env.get("REPORT_CRON_SECRET");
    const isCron = Boolean(expectedCronSecret && cronSecret && cronSecret === expectedCronSecret);
    let callerId: string | null = null;

    if (!isCron) {
      const authorization = request.headers.get("authorization") || "";
      const token = authorization.replace(/^Bearer\s+/i, "");
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData.user) return jsonResponse({ error: "Unauthorized" }, 401);
      callerId = userData.user.id;
      const { data: profile } = await admin.from("profiles").select("role,is_active").eq("id", callerId).single();
      if (!profile?.is_active || !["admin", "supervisor"].includes(profile.role)) return jsonResponse({ error: "Forbidden" }, 403);
      const { data: settingRow } = await admin.from("app_settings").select("value").eq("key", "require_manager_mfa").maybeSingle();
      const requireMfa = settingRow?.value !== false;
      const jwtPayload = decodeJwtPayload(authorization);
      if (requireMfa && jwtPayload.aal !== "aal2") return jsonResponse({ error: "MFA AAL2 wajib untuk menjalankan laporan secara manual." }, 403);
    }

    let schedules: Schedule[] = [];
    if (body.schedule_id) {
      const { data, error } = await admin.from("report_schedules").select("*").eq("id", body.schedule_id).single();
      if (error) throw error;
      schedules = [data as Schedule];
    } else {
      const { data, error } = await admin.rpc("claim_due_report_schedules", { p_limit: 20 });
      if (error) throw error;
      schedules = (data || []) as Schedule[];
    }

    const results: any[] = [];
    for (const schedule of schedules) {
      const period = periodFor(schedule);
      const runInsert = await admin.from("report_runs").insert({ schedule_id: schedule.id, schedule_name: schedule.name, status: "RUNNING", channel: schedule.channel, period_start: period.start, period_end: period.end, triggered_by: callerId }).select("id").single();
      if (runInsert.error) throw runInsert.error;
      const runId = runInsert.data.id;
      try {
        const production = await fetchAll(admin, "production_data", "date,shift,product,color,quantity,created_by,work_order_id,batch_id", (query) => query.gte("date", period.start).lte("date", period.end).is("deleted_at", null));
        const quality = await fetchAll(admin, "production_quality", "inspection_date,shift,product,inspected_quantity,good_quantity,reject_quantity,rework_quantity", (query) => query.gte("inspection_date", period.start).lte("inspection_date", period.end));
        const targets = await fetchAll(admin, "production_targets", "target_date,shift,product,target_quantity", (query) => query.gte("target_date", period.start).lte("target_date", period.end));
        const summary = buildSummary(production, quality, targets);
        const subject = `${schedule.name} • ${period.start} — ${period.end}`;
        const text = `${subject}\nProduksi: ${summary.total_quantity} Pcs\nTarget: ${summary.total_target} Pcs\nPencapaian: ${summary.achievement_percent}%\nYield: ${summary.yield_rate}%\nReject: ${summary.reject_quantity} (${summary.reject_rate}%)`;
        const delivery = await deliver(schedule, subject, reportHtml(schedule, period, summary), text);
        await admin.from("report_runs").update({ status: "SUCCESS", summary, delivery_response: delivery, finished_at: new Date().toISOString() }).eq("id", runId);
        await admin.from("report_schedules").update({ last_run_at: new Date().toISOString(), next_run_at: nextRunFor(schedule), last_claimed_at: null }).eq("id", schedule.id);
        results.push({ schedule_id: schedule.id, status: "SUCCESS", summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await admin.from("report_runs").update({ status: "FAILED", error_message: message.slice(0, 4000), finished_at: new Date().toISOString() }).eq("id", runId);
        await admin.from("report_schedules").update({ next_run_at: nextRunFor(schedule), last_claimed_at: null }).eq("id", schedule.id);
        results.push({ schedule_id: schedule.id, status: "FAILED", error: message });
      }
    }
    return jsonResponse({ processed: results.length, results });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
