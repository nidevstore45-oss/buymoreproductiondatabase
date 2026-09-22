import {cachedSupabaseFetch} from './cache-runtime';
import {validatePublicConfig} from './config-validation';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const configurationError = validatePublicConfig({url,key});
let client: SupabaseClient | undefined;
function getClient(): SupabaseClient {
  if (configurationError) throw new Error(configurationError);
  if (!client) client = createClient(url, key, {
    global: {fetch:cachedSupabaseFetch},
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true,
      storage:window.sessionStorage, storageKey:'buymore-auth-per-tab' },
  });
  return client;
}
/** Lazy access lets the existing root render a configuration error instead of a blank screen. */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance,property,instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
