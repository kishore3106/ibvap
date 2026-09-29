import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://epgibdkihcswaaresftw.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwZ2liZGtpaGNzd2FhcmVzZnR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNjMxOTcsImV4cCI6MjEwNDYzOTE5N30.echJzPzlM0UYhLjZ__TW7ldf_o52CFHDNtPfqhpMovU';

let storedUrl = '';
let storedKey = '';
try {
  storedUrl = localStorage.getItem('ibvap_supabase_url') || '';
  storedKey = localStorage.getItem('ibvap_supabase_key') || '';
} catch (_) {}

let rawUrl = (storedUrl || import.meta.env.VITE_SUPABASE_URL || '').trim();
let rawKey = (storedKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

let supabaseUrl = rawUrl || FALLBACK_URL;
let supabaseAnonKey = rawKey || FALLBACK_KEY;

// Auto-correct missing protocol or trailing slash
if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
  supabaseUrl = `https://${supabaseUrl}`;
}
supabaseUrl = supabaseUrl.replace(/\/+$/, '');

export function isSupabaseConfigured() {
  try {
    const url = (localStorage.getItem('ibvap_supabase_url') || import.meta.env.VITE_SUPABASE_URL || '').trim();
    return !!url && !url.includes('epgibdkihcswaaresftw');
  } catch (_) {
    return false;
  }
}

export function saveSupabaseCredentials(url, key) {
  try {
    if (url && url.trim()) {
      localStorage.setItem('ibvap_supabase_url', url.trim());
    } else {
      localStorage.removeItem('ibvap_supabase_url');
    }
    if (key && key.trim()) {
      localStorage.setItem('ibvap_supabase_key', key.trim());
    } else {
      localStorage.removeItem('ibvap_supabase_key');
    }
  } catch (_) {}
}

let client;
try {
  client = createClient(supabaseUrl, supabaseAnonKey);
} catch (err) {
  console.warn('[IBVAP Supabase] Failed to initialize with provided config, using fallback:', err);
  client = createClient(FALLBACK_URL, FALLBACK_KEY);
}

export const supabase = client;
