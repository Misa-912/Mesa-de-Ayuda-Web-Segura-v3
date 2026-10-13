# Cambios v2 → v3

Tipo: **CÓDIGO** = archivo fuente · **BD** = database.sql · **INSTRUCCIÓN** = manual/proceso.
Verificación: pruebas automáticas en Supabase local (20/25 con la v2 → 25/25 con la v3) y en PostgreSQL 17 con un propietario sin privilegios especiales, como en Neon (11/11).

| # | Tipo | Error en v2 | Síntoma | Corrección v3 |
|---|---|---|---|---|
| 1 | CÓDIGO | `event.currentTarget.reset()` después de `await` (registro, login, ticket) | Mensaje rojo "Cannot read properties of null (reading 'reset')" aunque el ticket o la cuenta sí se guardaron; la lista no se recarga | Se guarda el formulario en una constante antes del `await` (`src/main.ts`) |
| 2 | CÓDIGO | Faltaba `src/vite-env.d.ts` | `npm run build` falla: "Property 'env' does not exist on type 'ImportMeta'"; GitHub Actions falla | Archivo agregado |
| 3 | CÓDIGO/INSTRUCCIÓN | Faltaba `.github/workflows/deploy.yml` (el manual decía que venía incluido) | No se puede hacer el Paso 12 | Workflow agregado; valida que existan los Secrets |
| 4 | BD | Trigger `handle_new_user` usaba la parte local del correo (<3 letras) | Registro falla: "Database error saving new user" | Nombre alternativo "Usuario xx"; `on conflict do nothing` |
| 5 | BD | El técnico podía modificar cualquier columna (título, propietario) | Riesgo de seguridad | `grant update (status, technician_id)` y `grant insert` por columnas |
| 6 | BD | No había control de flujo de estados ni asignación de técnico | `technician_id` siempre vacío; se podía pasar de Cerrado a Abierto | Trigger `enforce_ticket_update` + asignación automática + auditoría `ASSIGN` |
| 7 | CÓDIGO | Categorías del HTML distintas de validation.ts y del CHECK (versión modificada por estudiantes) | "Categoría no válida" | Las listas viven en `src/types.ts` y el formulario se genera desde ahí |
| 8 | CÓDIGO | Estudiantes insertaban el perfil desde el navegador con `role: 'client'` | Falla silenciosa (CHECK + RLS) | Se elimina; el perfil lo crea solo el trigger y la v3 crea los perfiles faltantes |
| 9 | CÓDIGO | Límites distintos entre HTML, TS y SQL | Mensajes inconsistentes | Límites únicos en `LIMITS` (`src/types.ts`) |
| 10 | CÓDIGO | CSP solo permitía `*.supabase.co` y forzaba https | No funciona con Supabase local; algunos estudiantes la quitaron | CSP generada desde `VITE_SUPABASE_URL` (`vite.config.ts`) |
| 11 | CÓDIGO | Solo se aceptaba `VITE_SUPABASE_PUBLISHABLE_KEY` | Proyectos que muestran "anon key" | Acepta también `VITE_SUPABASE_ANON_KEY` |
| 12 | INSTRUCCIÓN | Se distribuyó un `.env` real dentro del .7z | Credencial expuesta | Rotar la clave; nunca comprimir `.env` |
| 13 | BD/INSTRUCCIÓN | `database.sql` no corre en Neon (`auth.users`, `auth.uid()`, roles) | "schema auth does not exist" | `neon/01_neon_prerequisitos.sql` + pruebas SQL |
| 14 | BD | `FORCE RLS` bloquea al propietario sin BYPASSRLS (Neon) | "new row violates row-level security policy for table profiles"; `update ... set role` afecta 0 filas | FORCE solo si el usuario tiene BYPASSRLS |
| 15 | CÓDIGO | CSP `style-src 'self'` bloquea los estilos en `npm run dev` | La página se ve sin diseño en local | `'unsafe-inline'` solo en desarrollo |
| 16 | CÓDIGO | Clases `alta`/`critica` no existían en el CSS (`high`/`critical`) | Prioridad sin color | Clases corregidas |
| 17 | CÓDIGO | `enterApp` se ejecutaba dos veces | Carga doble | Una sola entrada vía `onAuthStateChange` |
| 18 | CÓDIGO | Una actualización bloqueada por RLS (0 filas) se informaba como éxito | Falso "Estado actualizado" | Se verifica el número de filas |
| 19 | CÓDIGO | Errores de PostgreSQL en inglés o técnicos | El estudiante no sabe si es validación, RLS o configuración | `friendlyError()` traduce los códigos 23514, 42501, etc. |
| 20 | CÓDIGO/INSTRUCCIÓN | ZIP sin `package-lock.json` | `npm ci` del workflow falla | Se incluye el lockfile |
| + | CÓDIGO | — | — | Panel "Auditoría reciente" para admin; nombres de usuario y técnico en cada ticket; `npm run test:seguridad` |
