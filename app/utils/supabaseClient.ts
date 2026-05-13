import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Peringatan: SUPABASE URL atau ANON KEY tidak terdeteksi di .env.local. Mohon diisi terlebih dahulu agar multiplayer berfungsi!"
  );
}

// Inisiasi client Supabase tunggal untuk seluruh aplikasi Rummy
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
