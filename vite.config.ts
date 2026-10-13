import { defineConfig, loadEnv, type Plugin } from 'vite';

// Completa la Content-Security-Policy de index.html con el origen real de Supabase
// leído de .env (o de los Secrets de GitHub Actions). Así la CSP funciona con
// https://xxxx.supabase.co y también con Supabase local (http://127.0.0.1:54321).
function cspPlugin(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  let origins = '';
  if (env.VITE_SUPABASE_URL) {
    try {
      const url = new URL(env.VITE_SUPABASE_URL);
      origins = `${url.origin} ${url.origin.replace(/^http/, 'ws')}`;
    } catch {
      console.warn('VITE_SUPABASE_URL no es una URL válida.');
    }
  }
  const isLocalApi = /^http:\/\/(localhost|127\.0\.0\.1)/.test(env.VITE_SUPABASE_URL ?? '');
  return {
    name: 'helpdesk-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const dev = !!ctx.server;
        let out = html
          .replace('%SUPABASE_ORIGINS%', origins)
          // upgrade-insecure-requests solo en producción y si la API no es local (http).
          .replace('%UPGRADE_INSECURE%', dev || isLocalApi ? '' : '; upgrade-insecure-requests');
        // En desarrollo Vite inserta el CSS con etiquetas <style>; en el build el CSS va en un archivo.
        if (dev) out = out.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
        return out;
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Ruta relativa para que el build funcione en GitHub Pages,
  // incluso si se publica bajo /nombre-del-repositorio/.
  base: './',
  plugins: [cspPlugin(mode)],
}));
