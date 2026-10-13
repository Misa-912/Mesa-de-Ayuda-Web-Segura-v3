// =====================================================================
// PRUEBAS AUTOMÁTICAS DE SEGURIDAD - HelpDesk EDU
// Ejecutar:  npm run test:seguridad
// Requiere .env con VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.
// Crea usuarios de prueba con correos aleatorios (no usa datos reales).
// Para las pruebas de técnico/admin necesita que exista una cuenta técnica:
//   PRUEBA_TECNICO_EMAIL / PRUEBA_TECNICO_PASSWORD en el entorno (opcional).
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

function loadEnv() {
  const env = { ...process.env };
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env');
  process.exit(1);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASA ' : 'FALLA'}  ${name}${detail ? `  -> ${detail}` : ''}`);
}

function newClient() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const run = Date.now().toString(36);
const PASSWORD = `Prueba-${run}-Segura!`;

async function signUp(email, fullName) {
  const client = newClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { full_name: fullName } } });
  if (error) return { client, error };
  if (!data.session) {
    const r = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (r.error) return { client, error: r.error };
  }
  const { data: u } = await client.auth.getUser();
  return { client, user: u.user };
}

const validTicket = {
  title: 'No puedo ingresar al sistema',
  description: 'Al intentar ingresar aparece un mensaje de error.',
  category: 'Acceso',
  priority: 'Media',
};

// ---------- 1. Registro y perfil automático ----------
const A = await signUp(`usuario.a.${run}@prueba.test`, 'Usuario Prueba A');
check('Registro Usuario A', !A.error, A.error?.message);
const B = await signUp(`usuario.b.${run}@prueba.test`, 'Usuario Prueba B');
check('Registro Usuario B', !B.error, B.error?.message);

// Correo con parte local corta y sin nombre: antes rompía el trigger (CHECK 3..100).
const C = newClient();
const shortReg = await C.auth.signUp({ email: `ab@x${run}.test`, password: PASSWORD });
check('Registro con correo corto (ab@...) y sin nombre', !shortReg.error, shortReg.error?.message);

const profA = await A.client.from('profiles').select('id, full_name, role').eq('id', A.user.id).maybeSingle();
check('Perfil de A creado por trigger con rol usuario', profA.data?.role === 'usuario', JSON.stringify(profA.data ?? profA.error));

// ---------- 2. Tickets propios ----------
const insA = await A.client.from('tickets').insert({ user_id: A.user.id, ...validTicket }).select('id, status, technician_id').single();
check('Usuario A crea ticket válido', !insA.error && insA.data?.status === 'Abierto' && insA.data?.technician_id === null, insA.error?.message);
const ticketId = insA.data?.id;

const listB = await B.client.from('tickets').select('id');
check('Usuario B NO ve el ticket de A (RLS)', !listB.error && !listB.data.some(t => t.id === ticketId), `B ve ${listB.data?.length ?? '?'} tickets`);

const spoof = await B.client.from('tickets').insert({ user_id: A.user.id, ...validTicket });
check('Usuario B NO puede crear ticket a nombre de A', !!spoof.error, spoof.error?.code);

const selfStatus = await A.client.from('tickets').insert({ user_id: A.user.id, ...validTicket, status: 'Cerrado' });
check('Usuario NO puede crear ticket con estado distinto de Abierto', !!selfStatus.error, selfStatus.error?.code);

// ---------- 3. Usuario normal no administra ----------
const upd = await A.client.from('tickets').update({ status: 'Cerrado' }).eq('id', ticketId).select('id');
check('Usuario normal NO puede cambiar estado', !!upd.error || (upd.data ?? []).length === 0, upd.error?.code ?? '0 filas');

const roleUp = await A.client.from('profiles').update({ role: 'admin' }).eq('id', A.user.id).select('id');
check('Usuario normal NO puede hacerse admin', !!roleUp.error || (roleUp.data ?? []).length === 0, roleUp.error?.code ?? '0 filas');

const audA = await A.client.from('audit_logs').select('id');
check('Usuario normal NO lee audit_logs', !audA.error && audA.data.length === 0, audA.error?.code);

// ---------- 4. Restricciones SQL (simula atacante que no usa el formulario) ----------
const bad = [
  ['Título demasiado corto', { ...validTicket, title: 'abc' }],
  ['Descripción demasiado corta', { ...validTicket, description: 'corta' }],
  ['Categoría fuera de la lista', { ...validTicket, category: 'Inventada' }],
  ['Prioridad inválida', { ...validTicket, priority: 'Urgentísima' }],
  ['Título solo con espacios', { ...validTicket, title: '          ' }],
];
for (const [name, payload] of bad) {
  const r = await A.client.from('tickets').insert({ user_id: A.user.id, ...payload });
  check(`PostgreSQL rechaza: ${name}`, r.error?.code === '23514', r.error?.code ?? 'aceptado');
}

const xss = await A.client.from('tickets')
  .insert({ user_id: A.user.id, ...validTicket, title: '<script>alert(1)</script>' }).select('title').single();
check('Texto con <script> se guarda como texto plano (se neutraliza al mostrar con textContent)', !xss.error && xss.data?.title === '<script>alert(1)</script>', xss.error?.message);

const anon = newClient();
const anonList = await anon.from('tickets').select('id');
check('Anónimo NO lee tickets', !!anonList.error || anonList.data.length === 0, anonList.error?.code);

// ---------- 5. Técnico (opcional) ----------
if (env.PRUEBA_TECNICO_EMAIL && env.PRUEBA_TECNICO_PASSWORD) {
  const T = newClient();
  const login = await T.auth.signInWithPassword({ email: env.PRUEBA_TECNICO_EMAIL, password: env.PRUEBA_TECNICO_PASSWORD });
  check('Login técnico', !login.error, login.error?.message);
  const seen = await T.from('tickets').select('id').eq('id', ticketId);
  check('Técnico ve ticket de A', seen.data?.length === 1);
  const st = await T.from('tickets').update({ status: 'En proceso' }).eq('id', ticketId).select('status, technician_id').single();
  check('Técnico cambia Abierto -> En proceso', st.data?.status === 'En proceso', st.error?.message);
  check('Se asigna technician_id automáticamente', st.data?.technician_id === login.data.user?.id);
  const jump = await T.from('tickets').update({ status: 'Abierto' }).eq('id', ticketId).select('id');
  check('Transición no permitida queda bloqueada (En proceso -> Abierto)', !!jump.error, jump.error?.message);
  const title = await T.from('tickets').update({ title: 'Modificado por técnico' }).eq('id', ticketId).select('id');
  check('Técnico NO puede modificar el título del usuario', !!title.error, title.error?.code);
  const owner = await T.from('tickets').update({ user_id: login.data.user?.id }).eq('id', ticketId).select('id');
  check('Técnico NO puede cambiar el propietario', !!owner.error, owner.error?.code);
} else {
  console.log('\n(Omitidas pruebas de técnico: defina PRUEBA_TECNICO_EMAIL y PRUEBA_TECNICO_PASSWORD)');
}

const failed = results.filter(r => !r.ok).length;
console.log(`\nResultado: ${results.length - failed}/${results.length} pruebas pasan.`);
process.exit(failed ? 1 : 0);
