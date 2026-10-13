import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configError = !url || !publishableKey
  ? 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY. Copie .env.example a .env, complete los valores y reinicie npm run dev.'
  : null;

// La Publishable Key puede estar en el frontend. La Secret Key/service_role NUNCA debe exponerse.
// Si falta configuración se crea un cliente "vacío" para poder mostrar el error en pantalla
// en lugar de una página en blanco.
export const supabase = createClient(url || 'http://localhost', publishableKey || 'sin-clave', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
