/// <reference types="vite/client" />

// Sin este archivo `tsc` no reconoce import.meta.env y `npm run build` falla.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  // Proyectos Supabase antiguos muestran "anon public key"; se acepta como alternativa.
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
