# HelpDesk EDU v3 - TypeScript + Supabase + PostgreSQL

Proyecto académico de mesa de ayuda con frontend estático y seguridad aplicada en varias capas.
La v3 corrige los errores detectados en la v2. El detalle está en [CAMBIOS_v3.md](CAMBIOS_v3.md).

## Tecnologías
- HTML5, CSS3 y TypeScript (modo estricto) compilados con Vite.
- Supabase Auth para autenticación y PostgreSQL (Supabase) como base de datos.
- Row Level Security (RLS) como autorización real.
- GitHub + GitHub Actions + GitHub Pages para publicar.

## Capas de seguridad incluidas
1. HTTPS al publicar ("Enforce HTTPS" en GitHub Pages).
2. Content Security Policy (CSP) generada en el build con el origen real de Supabase.
3. Supabase Auth para sesiones.
4. Validación del lado cliente (`src/validation.ts`) con las mismas reglas que la base.
5. Restricciones CHECK en PostgreSQL: el servidor vuelve a validar.
6. RLS: el usuario solo lee sus tickets; técnico/admin gestionan.
7. Privilegio mínimo: el técnico solo puede modificar `status` y `technician_id`.
8. Flujo controlado de estados aplicado por un trigger.
9. Secretos: solo la Publishable Key en el frontend; nunca Secret Key/service_role.
10. Protección XSS: el contenido se muestra con `textContent`.
11. Auditoría: cambios de estado y asignación en `audit_logs` (visible para admin).

## Estructura
| Archivo | Función |
|---|---|
| `index.html` | HTML base y CSP (los marcadores `%...%` los completa `vite.config.ts`). |
| `src/main.ts` | Lógica de interfaz y eventos. |
| `src/types.ts` | Tipos y **listas oficiales** (categorías, prioridades, estados, límites). |
| `src/validation.ts` | Validaciones y traducción de errores de la base a mensajes claros. |
| `src/supabase.ts` | Cliente Supabase (lee `.env`). |
| `src/vite-env.d.ts` | Tipos de `import.meta.env` (sin este archivo `npm run build` falla). |
| `database.sql` | Tablas, CHECK, triggers, RLS y permisos. Se puede ejecutar más de una vez. |
| `neon/` | Scripts para practicar la base de datos en Neon. |
| `pruebas/pruebas_seguridad.mjs` | Pruebas automáticas de RLS y validaciones. |
| `.github/workflows/deploy.yml` | Publicación automática en GitHub Pages. |

> Para agregar una categoría se modifica `src/types.ts` **y** el CHECK `tickets_category_check` de `database.sql`. Si solo se cambia el HTML aparece "Categoría no válida".

## 1. Crear la base en Supabase
1. Cree un proyecto gratuito en https://supabase.com.
2. Abra **SQL Editor > New query**, pegue `database.sql` completo y pulse **Run**.
3. En **Authentication > Providers** deje Email activado.

Si ya tenía la base de la v2, ejecute igualmente el `database.sql` v3: actualiza restricciones, funciones y permisos sin borrar tickets, y crea los perfiles que falten.

## 2. Variables del frontend
```bash
cp .env.example .env
```
```env
VITE_SUPABASE_URL=https://SU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```
Si su proyecto muestra "anon public key", úsela en la misma variable. Reinicie `npm run dev` después de modificar `.env`.

## 3. Ejecutar localmente
```bash
npm install
npm run dev
```

## 4. Crear técnico y administrador
Registre la cuenta desde la aplicación y luego, en SQL Editor:
```sql
update public.profiles
set role = 'admin'   -- o 'tecnico'
where id = (select id from auth.users where email = 'SU_CORREO');
```
Cierre sesión y vuelva a ingresar.

## 5. Probar seguridad
Manual: Usuario A vs Usuario B, usuario normal sin permisos, técnico cambia estado, auditoría.

Automático (crea usuarios de prueba con correos `@prueba.test`):
```bash
npm run test:seguridad
```
Para incluir las pruebas de técnico, cree un técnico y ejecute (PowerShell):
```powershell
$env:PRUEBA_TECNICO_EMAIL="tecnico@ejemplo.com"; $env:PRUEBA_TECNICO_PASSWORD="su-clave"; npm run test:seguridad
```
Resultado esperado: `25/25 pruebas pasan`.

Flujo de estados para técnico: Abierto → En proceso | Cerrado · En proceso → Resuelto · Resuelto → Cerrado | En proceso. Solo el admin puede reabrir un ticket cerrado.

## 6. Publicar en GitHub Pages
1. Suba el repositorio, **incluido `package-lock.json`** y sin `.env`.
2. **Settings > Secrets and variables > Actions**: cree `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. **Settings > Pages > Source: GitHub Actions**.
4. Haga push a `main` y revise la pestaña **Actions**.
5. Active **Enforce HTTPS**.

## 7. Neon
`database.sql` usa `auth.users`, `auth.uid()` y los roles `anon`/`authenticated`, que solo existen en Supabase. En Neon:
0. Solo si ya había montado algo antes: `neon/00_neon_reiniciar.sql` (borra las tablas de práctica).
1. `neon/01_neon_prerequisitos.sql`
2. `database.sql`
3. `neon/02_neon_pruebas_rls.sql` (cada prueba imprime PASA/FALLA)

La aplicación web usa Supabase Auth y la API de Supabase, así que **no se conecta a Neon**. Neon sirve para practicar el modelo de datos, los CHECK, los triggers y las políticas RLS.

## Nota de seguridad
GitHub Pages es hosting estático. Las operaciones privilegiadas van en un backend (por ejemplo Supabase Edge Functions), nunca en el navegador.
