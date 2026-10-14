import './styles.css';
import { configError, supabase } from './supabase';
import { friendlyError, validateEmail, validateName, validatePassword, validateTicket } from './validation';
import { CATEGORIES, LIMITS, PRIORITIES, STATUS_FLOW, STATUSES } from './types';
import type { AuditLog, Profile, Ticket, TicketStatus } from './types';
import type { User } from '@supabase/supabase-js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento faltante: #${id}`);
  return node as T;
}

const authView = el<HTMLElement>('authView');
const appView = el<HTMLElement>('appView');
const toast = el<HTMLElement>('toast');
let currentUser: User | null = null;
let currentProfile: Profile | null = null;
let ticketsCache: Ticket[] = [];
let toastTimer: number | undefined;

function notify(message: string, type: 'ok' | 'error' = 'ok'): void {
  // textContent evita interpretar HTML recibido de errores o entradas del usuario.
  toast.textContent = message;
  toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.className = 'toast'; }, 4500);
}

// Deshabilita el botón mientras se espera a Supabase para evitar envíos dobles.
async function withBusy(form: HTMLFormElement, task: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try { await task(); } finally { if (button) button.disabled = false; }
}

function fillSelect(select: HTMLSelectElement, options: readonly { value: string; label: string }[], selected?: string): void {
  select.replaceChildren(...options.map(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value; option.textContent = label; option.selected = value === selected;
    return option;
  }));
}

// Las opciones y límites del formulario salen de types.ts: así el HTML no puede
// quedar distinto de la validación y de los CHECK de PostgreSQL.
function setupForms(): void {
  fillSelect(el<HTMLSelectElement>('ticketCategory'), CATEGORIES);
  fillSelect(el<HTMLSelectElement>('ticketPriority'), PRIORITIES.map(p => ({ value: p, label: p })), 'Media');
  fillSelect(el<HTMLSelectElement>('statusFilter'), [{ value: 'todos', label: 'Todos' }, ...STATUSES.map(s => ({ value: s, label: s }))]);
  const title = el<HTMLInputElement>('ticketTitle');
  title.minLength = LIMITS.titleMin; title.maxLength = LIMITS.titleMax;
  const description = el<HTMLTextAreaElement>('ticketDescription');
  description.minLength = LIMITS.descriptionMin; description.maxLength = LIMITS.descriptionMax;
}

function setTab(tab: 'login' | 'register'): void {
  const login = tab === 'login';
  el<HTMLButtonElement>('loginTab').classList.toggle('active', login);
  el<HTMLButtonElement>('registerTab').classList.toggle('active', !login);
  el<HTMLFormElement>('loginForm').classList.toggle('hidden', !login);
  el<HTMLFormElement>('registerForm').classList.toggle('hidden', login);
}

el<HTMLButtonElement>('loginTab').addEventListener('click', () => setTab('login'));
el<HTMLButtonElement>('registerTab').addEventListener('click', () => setTab('register'));

// IMPORTANTE: el formulario se guarda en una constante ANTES del await.
// Después de un await, event.currentTarget vale null y .reset() lanzaba
// "Cannot read properties of null", mostrando un error aunque la operación sí se guardó.
el<HTMLFormElement>('registerForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  void withBusy(form, async () => {
    try {
      const fullName = validateName(el<HTMLInputElement>('registerName').value);
      const email = validateEmail(el<HTMLInputElement>('registerEmail').value);
      const password = validatePassword(el<HTMLInputElement>('registerPassword').value);
      // El perfil lo crea el trigger on_auth_user_created; el frontend NO inserta en profiles.
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw error;
      form.reset();
      if (data.session) {
        notify('Cuenta creada correctamente.');
      } else {
        notify('Cuenta creada. Revise su correo para confirmarla y luego inicie sesión.');
        setTab('login');
      }
    } catch (error) { notify(friendlyError(error, 'Error al registrar.'), 'error'); }
  });
});

el<HTMLFormElement>('loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  void withBusy(form, async () => {
    try {
      const email = validateEmail(el<HTMLInputElement>('loginEmail').value);
      const password = validatePassword(el<HTMLInputElement>('loginPassword').value);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(error.message.includes('Email not confirmed')
          ? 'Debe confirmar su correo antes de iniciar sesión.'
          : 'Credenciales no válidas o acceso rechazado.');
      }
      form.reset();
      // La entrada a la aplicación la hace onAuthStateChange (evento SIGNED_IN).
    } catch (error) { notify(friendlyError(error, 'No se pudo iniciar sesión.'), 'error'); }
  });
});

el<HTMLButtonElement>('logoutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); });

el<HTMLFormElement>('ticketForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!currentUser) return;
  const userId = currentUser.id;
  void withBusy(form, async () => {
    try {
      const clean = validateTicket({
        title: el<HTMLInputElement>('ticketTitle').value,
        description: el<HTMLTextAreaElement>('ticketDescription').value,
        category: el<HTMLSelectElement>('ticketCategory').value,
        priority: el<HTMLSelectElement>('ticketPriority').value,
      });
      const { error } = await supabase.from('tickets').insert({ user_id: userId, ...clean });
      if (error) throw error;
      form.reset();
      el<HTMLSelectElement>('ticketPriority').value = 'Media';
      notify('Ticket registrado correctamente.');
      await loadTickets();
    } catch (error) { notify(friendlyError(error, 'No se pudo registrar el ticket.'), 'error'); }
  });
});

el<HTMLSelectElement>('statusFilter').addEventListener('change', renderTickets);
el<HTMLButtonElement>('refreshBtn').addEventListener('click', () => void loadTickets());
el<HTMLButtonElement>('refreshAuditBtn').addEventListener('click', () => void loadAudit());

async function loadProfile(): Promise<void> {
  if (!currentUser) return;
  const { data, error } = await supabase.from('profiles').select('id, full_name, role').eq('id', currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    // No se crea el perfil desde el navegador (no hay permiso, por seguridad).
    // Si falta, el trigger no se ejecutó: hay que correr database.sql v3, que crea los perfiles faltantes.
    throw new Error('Su usuario no tiene perfil en public.profiles. El administrador debe ejecutar database.sql (v3).');
  }
  currentProfile = data as Profile;
  el<HTMLElement>('currentUserName').textContent = currentProfile.full_name || currentUser.email || 'Usuario';
  el<HTMLElement>('currentUserRole').textContent = currentProfile.role;
  el<HTMLElement>('ticketListTitle').textContent = isStaff() ? 'Todos los tickets' : 'Mis tickets';
  el<HTMLElement>('auditPanel').classList.toggle('hidden', !isAdmin());
}

function isStaff(): boolean { return currentProfile?.role === 'admin' || currentProfile?.role === 'tecnico'; }
function isAdmin(): boolean { return currentProfile?.role === 'admin'; }

async function loadTickets(): Promise<void> {
  if (!currentUser) return;
  const listEl = el<HTMLElement>('ticketList');
  listEl.replaceChildren(makeEmpty('Cargando tickets...'));
  // Los nombres de propietario y técnico solo son visibles para staff (RLS de profiles).
  let query = supabase
    .from('tickets')
    .select('*, owner:profiles!tickets_user_id_fkey(full_name), technician:profiles!tickets_technician_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (!isStaff()) query = query.eq('user_id', currentUser.id);
  const { data, error } = await query;
  if (error) {
    listEl.replaceChildren(makeEmpty('No fue posible cargar los tickets.'));
    notify(friendlyError(error, 'No se pudieron cargar los tickets.'), 'error');
    return;
  }
  ticketsCache = (data ?? []) as Ticket[];
  updateStats();
  renderTickets();
  if (isAdmin()) await loadAudit();
}

function updateStats(): void {
  el<HTMLElement>('statTotal').textContent = String(ticketsCache.length);
  el<HTMLElement>('statOpen').textContent = String(ticketsCache.filter(t => t.status === 'Abierto').length);
  el<HTMLElement>('statProgress').textContent = String(ticketsCache.filter(t => t.status === 'En proceso').length);
  el<HTMLElement>('statResolved').textContent = String(ticketsCache.filter(t => t.status === 'Resuelto' || t.status === 'Cerrado').length);
}

function makeEmpty(text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.textContent = text;
  return div;
}

function makeBadge(text: string, className = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `badge ${className}`.trim();
  span.textContent = text;
  return span;
}

function statusClass(status: TicketStatus): string {
  return { 'Abierto': 'open', 'En proceso': 'progress', 'Resuelto': 'resolved', 'Cerrado': 'closed' }[status];
}

function categoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label ?? value;
}

function renderTickets(): void {
  const filter = el<HTMLSelectElement>('statusFilter').value;
  const tickets = filter === 'todos' ? ticketsCache : ticketsCache.filter(t => t.status === filter);
  const listEl = el<HTMLElement>('ticketList');
  listEl.replaceChildren();
  if (!tickets.length) { listEl.append(makeEmpty('No hay tickets para mostrar.')); return; }

  for (const ticket of tickets) {
    const article = document.createElement('article'); article.className = 'ticket';
    const top = document.createElement('div'); top.className = 'ticket-top';
    const titleBox = document.createElement('div');
    const eyebrow = document.createElement('span'); eyebrow.className = 'eyebrow'; eyebrow.textContent = `TICKET #${ticket.id}`;
    const h3 = document.createElement('h3'); h3.textContent = ticket.title;
    titleBox.append(eyebrow, h3); top.append(titleBox, makeBadge(ticket.status, statusClass(ticket.status)));
    const p = document.createElement('p'); p.textContent = ticket.description;
    const meta = document.createElement('div'); meta.className = 'ticket-meta';
    meta.append(
      makeBadge(categoryLabel(ticket.category)),
      makeBadge(`Prioridad: ${ticket.priority}`, ticket.priority === 'Alta' ? 'high' : ticket.priority === 'Crítica' ? 'critical' : ''),
      makeBadge(new Date(ticket.created_at).toLocaleString('es-HN')),
    );
    if (isStaff() && ticket.owner?.full_name) meta.append(makeBadge(`Usuario: ${ticket.owner.full_name}`));
    if (ticket.technician?.full_name) meta.append(makeBadge(`Técnico: ${ticket.technician.full_name}`));
    article.append(top, p, meta);

    if (isStaff()) article.append(makeStaffActions(ticket));
    listEl.append(article);
  }
}

function makeStaffActions(ticket: Ticket): HTMLElement {
  const actions = document.createElement('div'); actions.className = 'staff-actions';
  // El técnico solo ve los cambios permitidos por el flujo; el admin ve todos.
  // La regla real está en PostgreSQL (enforce_ticket_update), esto solo ayuda al usuario.
  const next = isAdmin() ? STATUSES.filter(s => s !== ticket.status) : STATUS_FLOW[ticket.status];
  if (!next.length) {
    actions.append(makeBadge('Ticket cerrado: solo un administrador puede reabrirlo.'));
    return actions;
  }
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Cambiar estado del ticket ${ticket.id}`);
  fillSelect(select, next.map(s => ({ value: s, label: s })));
  const button = document.createElement('button'); button.className = 'btn secondary'; button.type = 'button'; button.textContent = 'Guardar estado';
  button.addEventListener('click', async () => {
    button.disabled = true;
    await updateTicketStatus(ticket.id, select.value as TicketStatus);
    button.disabled = false;
  });
  actions.append(select, button);
  return actions;
}

async function updateTicketStatus(ticketId: number, newStatus: TicketStatus): Promise<void> {
  if (!isStaff()) { notify('No tiene permisos para modificar estados.', 'error'); return; }
  const { data, error } = await supabase.from('tickets').update({ status: newStatus }).eq('id', ticketId).select('id');
  if (error) { notify(friendlyError(error, 'No se pudo actualizar el ticket.'), 'error'); return; }
  // Con RLS, una actualización bloqueada no da error: simplemente afecta 0 filas.
  if (!data?.length) { notify('La base de datos no permitió el cambio (RLS). Verifique su rol.', 'error'); return; }
  notify('Estado actualizado.');
  await loadTickets();
}

async function loadAudit(): Promise<void> {
  const listEl = el<HTMLElement>('auditList');
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, ticket_id, action, old_status, new_status, created_at, actor:profiles!audit_logs_actor_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { listEl.replaceChildren(makeEmpty(friendlyError(error, 'No se pudo cargar la auditoría.'))); return; }
  const logs = (data ?? []) as unknown as AuditLog[];
  if (!logs.length) { listEl.replaceChildren(makeEmpty('Sin cambios registrados todavía.')); return; }
  listEl.replaceChildren(...logs.map(log => {
    const row = document.createElement('div'); row.className = 'audit-row';
    const what = log.action === 'CREATE'
    ? `creó el ticket · estado inicial: ${log.new_status ?? 'abierto'}`
    : log.action === 'ASSIGN'
      ? 'asignó técnico'
      : `${log.old_status ?? '-'} → ${log.new_status ?? '-'}`;

    row.textContent = `#${log.ticket_id} · ${what} · ${log.actor?.full_name ?? 'sistema'} · ${new Date(log.created_at).toLocaleString('es-HN')}`;
    return row;
  }));
}

let enteredUserId: string | null = null;

async function enterApp(user: User): Promise<void> {
  // Evita cargar dos veces (Supabase emite SIGNED_IN también al refrescar la sesión o cambiar de pestaña).
  if (enteredUserId === user.id) return;
  enteredUserId = user.id;
  currentUser = user;
  try {
    await loadProfile();
    authView.classList.add('hidden'); appView.classList.remove('hidden');
    await loadTickets();
  } catch (error) {
    enteredUserId = null;
    notify(friendlyError(error, 'No fue posible cargar el perfil.'), 'error');
    await supabase.auth.signOut();
  }
}

function leaveApp(): void {
  enteredUserId = null; currentUser = null; currentProfile = null; ticketsCache = [];
  appView.classList.add('hidden'); authView.classList.remove('hidden');
}

function init(): void {
  setupForms();
  if (configError) {
    el<HTMLElement>('configError').textContent = configError;
    el<HTMLElement>('configError').classList.remove('hidden');
    return;
  }
  // INITIAL_SESSION cubre la sesión guardada; SIGNED_IN cubre login y registro con sesión.
  // supabase-js recomienda no hacer await dentro de este callback: se difiere con setTimeout.
  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
      const user = session.user;
      window.setTimeout(() => void enterApp(user), 0);
    }
    if (event === 'SIGNED_OUT') leaveApp();
  });
}

init();
