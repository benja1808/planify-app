// Credenciales de Supabase para los scripts locales: se leen de .env (no versionado).
import { existsSync } from 'node:fs';

const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY. Copia .env.example a .env y complétalo.');
    process.exit(1);
}
