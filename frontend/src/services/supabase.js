import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://epgibdkihcswaaresftw.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwZ2liZGtpaGNzd2FhcmVzZnR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNjMxOTcsImV4cCI6MjEwNDYzOTE5N30.echJzPzlM0UYhLjZ__TW7ldf_o52CFHDNtPfqhpMovU';

let rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
let rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

let supabaseUrl = rawUrl || FALLBACK_URL;
let supabaseAnonKey = rawKey || FALLBACK_KEY;

// Auto-correct missing protocol or trailing slash
if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
  supabaseUrl = `https://${supabaseUrl}`;
}
supabaseUrl = supabaseUrl.replace(/\/+$/, '');

let client;
try {
  client = createClient(supabaseUrl, supabaseAnonKey);
} catch (err) {
  console.warn('[IBVAP Supabase] Failed to initialize with provided config, using fallback:', err);
  client = createClient(FALLBACK_URL, FALLBACK_KEY);
}

export const supabase = client;
