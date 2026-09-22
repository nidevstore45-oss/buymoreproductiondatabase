/** Public build configuration only. JWT validation remains the Supabase Auth server's responsibility. */
export function validatePublicConfig(input: {url?:string;key?:string}): string {
  const url=String(input.url||'').trim();
  const key=String(input.key||'').trim();
  if (!url || !key) return 'VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY belum dikonfigurasi. Isi environment variables lalu build ulang.';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname)))
      return 'URL Supabase harus HTTPS; HTTP hanya diizinkan untuk pengujian localhost.';
    if (parsed.username || parsed.password) return 'URL Supabase tidak boleh mengandung credential.';
  } catch { return 'VITE_SUPABASE_URL bukan URL yang valid.'; }
  if (key.startsWith('sb_secret_')) return 'Secret key tidak boleh dipakai di frontend. Gunakan publishable/anon key.';
  if (key.split('.').length === 3) {
    try {
      const encoded = key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
      if (payload.role !== 'anon') return 'Hanya anon key yang boleh dipakai di frontend, bukan service-role/user token.';
    } catch { return 'Format anon key tidak valid.'; }
  } else if (!key.startsWith('sb_publishable_')) return 'Gunakan anon JWT atau Supabase publishable key.';
  return '';
}
