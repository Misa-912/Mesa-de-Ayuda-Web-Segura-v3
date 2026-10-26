import './styles.css';
import { configError, supabase } from './supabase';
import { friendlyError, validateEmail, validateName, validatePassword, validateTicket } from './validation';
import { CATEGORIES, LIMITS, PRIORITIES, STATUS_FLOW, STATUSES } from './types';
import type { AuditLog, Profile, Ticket, TicketStatus, UserRole } from './types';
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
let techniciansCache: Profile[] = [];
let allUsersCache: Profile[] = [];
let toastTimer: number | undefined;

function notify(message: string, type: 'ok' | 'error' = 'ok'): void {
  toast.textContent = message;
  toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.className = 'toast'; }, 4500);
}

async function withBusy(form: HTMLFormElement, task: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try { await task(); } finally { if (button) button.disabled = false; }
}

function fillSelect(select: HTMLSelectElement, options: readonly { value: string; label: string }[], selected?: string): void {
  select.replaceChildren(...options.map(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    return option;
  }));
}

function setupForms(): void {
  fillSelect(el<HTMLSelectElement>('ticketCategory'), CATEGORIES);
  fillSelect(el<HTMLSelectElement>('ticketPriority'), PRIORITIES.map(p => ({ value: p, label: p })), 'Media');
  fillSelect(el<HTMLSelectElement>('statusFilter'), [{ value: 'todos', label: 'Todos' }, ...STATUSES.map(s => ({ value: s, label: s }))]);
  const title = el<HTMLInputElement>('ticketTitle');
  title.minLength = LIMITS.titleMin;
  title.maxLength = LIMITS.titleMax;
  const description = el<HTMLTextAreaElement>('ticketDescription');
  description.minLength = LIMITS.descriptionMin;
  description.maxLength = LIMITS.descriptionMax;
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

el<HTMLFormElement>('registerForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  void withBusy(form, async () => {
    try {
      const fullName = validateName(el<HTMLInputElement>('registerName').value);
      const email = validateEmail(el<HTMLInputElement>('registerEmail').value);
      const password = validatePassword(el<HTMLInputElement>('registerPassword').value);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      form.reset();
      if (data.session) {
        notify('Cuenta creada correctamente.');
      } else {
        notify('Cuenta creada. Revise su correo para confirmarla y luego inicie sesión.');
        setTab('login');
      }
    } catch (error) {
      notify(friendlyError(error, 'Error al registrar.'), 'error');
    }
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
    } catch (error) {
      notify(friendlyError(error, 'No se pudo iniciar sesión.'), 'error');
    }
  });
});

el<HTMLButtonElement>('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

const dashboardNavLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>(
    '.side-nav a.nav-item[href^="#"]'
  )
);

// Sistema de enrutamiento por pestañas (separa la vista de tickets y la vista de usuarios)
function handleViewRouting(): void {
  const targetId = window.location.hash || '#dashboardTop';
  
  dashboardNavLinks.forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === targetId);
  });

  const isUsersView = targetId === '#adminUsersPanel' || targetId === '#adminUsersSection';
  
  // Oculta o muestra los elementos principales del dashboard de tickets
  const ticketPanels = document.querySelectorAll<HTMLElement>('.stats-grid, .content-grid');
  ticketPanels.forEach(panel => {
    panel.style.display = isUsersView ? 'none' : '';
  });

  // Muestra u oculta el panel de administración de usuarios de forma independiente
  const userAdminPanel = document.getElementById('adminUsersPanel') || document.getElementById('adminUsersSection');
  if (userAdminPanel) {
    userAdminPanel.classList.toggle('hidden', !isUsersView);
    // Asegurar que ocupe el espacio principal si está activo
    userAdminPanel.style.display = isUsersView ? 'block' : 'none';
  }
}

window.addEventListener('hashchange', handleViewRouting);

dashboardNavLinks.forEach((link) => {
  link.addEventListener('click', () => {
    window.setTimeout(handleViewRouting, 10);
  });
});

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

      const { error } = await supabase
        .from('tickets')
        .insert({ user_id: userId, ...clean });

      if (error) throw error;

      form.reset();
      el<HTMLSelectElement>('ticketPriority').value = 'Media';
      notify('Ticket registrado correctamente.');
      await loadTickets();
    } catch (error) {
      notify(friendlyError(error, 'No se pudo registrar el ticket.'), 'error');
    }
  });
});

el<HTMLSelectElement>('statusFilter').addEventListener('change', renderTickets);
el<HTMLButtonElement>('refreshBtn').addEventListener('click', () => void loadTickets());
el<HTMLButtonElement>('refreshAuditBtn').addEventListener('click', () => void loadAudit());
document.getElementById('refreshUsersBtn')?.addEventListener('click', () => void loadUsersList());

async function loadProfile(): Promise<void> {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error('Su usuario no tiene perfil en public.profiles. El administrador debe ejecutar database.sql (v3).');
  }

  currentProfile = data as Profile;

  if (isAdmin()) {
    try {
      await loadTechnicians();
      await loadUsersList();
    } catch (error) {
      techniciansCache = [];
      allUsersCache = [];
      notify(friendlyError(error, 'No se pudo cargar la información administrativa.'), 'error');
    }
  }

  el<HTMLElement>('currentUserName').textContent =
    currentProfile.full_name || currentUser.email || 'Usuario';
  el<HTMLElement>('currentUserRole').textContent = currentProfile.role;
  el<HTMLElement>('ticketListTitle').textContent =
    isStaff() ? 'Todos los tickets' : 'Mis tickets';
  el<HTMLElement>('auditPanel').classList.toggle('hidden', !isAdmin());

  const navAdminUsers = document.getElementById('navAdminUsers');
  if (navAdminUsers) {
    navAdminUsers.classList.toggle('hidden', !isAdmin());
  }

  const userAdminPanel = document.getElementById('adminUsersPanel') || document.getElementById('adminUsersSection');
  if (userAdminPanel) {
    userAdminPanel.classList.add('hidden');
    userAdminPanel.style.display = 'none';
  }

  handleViewRouting();
}

function isStaff(): boolean {
  return currentProfile?.role === 'admin' || currentProfile?.role === 'tecnico';
}

function isAdmin(): boolean {
  return currentProfile?.role === 'admin';
}

async function loadTechnicians(): Promise<void> {
  if (!isAdmin()) {
    techniciansCache = [];
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('role', 'tecnico')
    .order('full_name', { ascending: true });

  if (error) throw error;

  techniciansCache = (data ?? []) as Profile[];
}

async function loadUsersList(): Promise<void> {
  if (!isAdmin()) {
    allUsersCache = [];
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .order('full_name', { ascending: true });

  if (error) throw error;

  allUsersCache = (data ?? []) as Profile[];
  renderAdminUsersPanel();
}

function renderAdminUsersPanel(): void {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;

  tbody.replaceChildren();

  if (!allUsersCache.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.style.padding = '16px';
    td.style.textAlign = 'center';
    td.textContent = 'No hay usuarios registrados.';
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const userProfile of allUsersCache) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

    const tdName = document.createElement('td');
    tdName.style.padding = '12px 10px';
    tdName.textContent = userProfile.full_name?.trim() || 'Sin nombre';

    const tdRole = document.createElement('td');
    tdRole.style.padding = '12px 10px';
    tdRole.textContent = userProfile.role;

    const tdAction = document.createElement('td');
    tdAction.style.padding = '12px 10px';

    const actionContainer = document.createElement('div');
    actionContainer.style.display = 'flex';
    actionContainer.style.alignItems = 'center';
    actionContainer.style.gap = '12px';

    const selectRole = document.createElement('select');
    selectRole.style.padding = '8px 12px';
    selectRole.style.borderRadius = '6px';
    selectRole.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    selectRole.style.background = 'rgba(15, 23, 42, 0.6)';
    selectRole.style.color = '#fff';
    
    fillSelect(selectRole, [
      { value: 'usuario', label: 'Usuario' },
      { value: 'tecnico', label: 'Técnico' },
      { value: 'admin', label: 'Administrador' },
    ], userProfile.role);

    const btnSaveRole = document.createElement('button');
    btnSaveRole.type = 'button';
    btnSaveRole.className = 'btn secondary';
    btnSaveRole.style.padding = '8px 14px';
    btnSaveRole.style.margin = '0';
    btnSaveRole.textContent = 'Guardar';

    btnSaveRole.addEventListener('click', async () => {
      const newRole = selectRole.value as UserRole;
      if (newRole === userProfile.role) {
        notify('El usuario ya tiene ese rol.', 'error');
        return;
      }

      btnSaveRole.disabled = true;
      selectRole.disabled = true;

      try {
        await updateUserRole(userProfile.id, newRole);
      } finally {
        btnSaveRole.disabled = false;
        selectRole.disabled = false;
      }
    });

    actionContainer.append(selectRole, btnSaveRole);
    tdAction.append(actionContainer);
    tr.append(tdName, tdRole, tdAction);
    tbody.append(tr);
  }
}

async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
  if (!isAdmin()) {
    notify('Solo un administrador puede cambiar roles.', 'error');
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  if (error) {
    notify(friendlyError(error, 'No se pudo actualizar el rol del usuario.'), 'error');
    return;
  }

  notify('Rol actualizado correctamente.');
  await loadUsersList();
  await loadTechnicians();
}

async function loadTickets(): Promise<void> {
  if (!currentUser) return;

  const listEl = el<HTMLElement>('ticketList');
  listEl.replaceChildren(makeEmpty('Cargando tickets...'));

  let query = supabase
    .from('tickets')
    .select('*, owner:profiles!tickets_user_id_fkey(full_name), technician:profiles!tickets_technician_id_fkey(full_name)')
    .order('created_at', { ascending: false });

  if (!isStaff()) {
    query = query.eq('user_id', currentUser.id);
  }

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
  el<HTMLElement>('statOpen').textContent =
    String(ticketsCache.filter(t => t.status === 'Abierto').length);
  el<HTMLElement>('statProgress').textContent =
    String(ticketsCache.filter(t => t.status === 'En proceso').length);
  el<HTMLElement>('statResolved').textContent =
    String(ticketsCache.filter(t => t.status === 'Resuelto' || t.status === 'Cerrado').length);
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
  return {
    'Abierto': 'open',
    'En proceso': 'progress',
    'Resuelto': 'resolved',
    'Cerrado': 'closed',
  }[status];
}

function categoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label ?? value;
}

function printSingleTicket(ticket: Ticket): void {
  const win = window.open('', '_blank');
  if (!win) return;

  const createdDate = new Date(ticket.created_at).toLocaleString('es-HN');
  const cat = categoryLabel(ticket.category);
  const ownerName = ticket.owner?.full_name || currentProfile?.full_name || currentUser?.email || 'Usuario';
  const techName = ticket.technician?.full_name || 'Sin asignar';

  win.document.write(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Comprobante Ticket #${ticket.id} - HelpDesk EDU</title>
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          padding: 40px;
          color: #0f172a;
          max-width: 700px;
          margin: 0 auto;
          background: #ffffff;
        }
        .header {
          border-bottom: 3px solid #0284c7;
          padding-bottom: 16px;
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .brand {
          font-size: 22px;
          font-weight: 800;
          color: #0284c7;
        }
        .ticket-number {
          font-size: 18px;
          font-weight: 700;
          background: #f1f5f9;
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
        }
        .section-title {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748b;
          margin-bottom: 6px;
        }
        .title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 20px;
          color: #1e293b;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          background: #f8fafc;
          padding: 18px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          margin-bottom: 24px;
        }
        .item strong {
          display: block;
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
        }
        .item span {
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
        }
        .description-box {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          padding: 16px;
          border-radius: 8px;
          min-height: 120px;
          font-size: 14px;
          line-height: 1.6;
          white-space: pre-wrap;
          margin-bottom: 30px;
        }
        .footer {
          border-top: 1px solid #e2e8f0;
          padding-top: 16px;
          font-size: 12px;
          color: #94a3b8;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">HelpDesk EDU</div>
        <div class="ticket-number">TICKET #${ticket.id}</div>
      </div>

      <div class="section-title">ASUNTO DEL PROBLEMA</div>
      <div class="title">${ticket.title}</div>

      <div class="grid">
        <div class="item"><strong>Estado</strong><span>${ticket.status}</span></div>
        <div class="item"><strong>Prioridad</strong><span>${ticket.priority}</span></div>
        <div class="item"><strong>Categoría</strong><span>${cat}</span></div>
        <div class="item"><strong>Fecha de registro</strong><span>${createdDate}</span></div>
        <div class="item"><strong>Usuario Solicitante</strong><span>${ownerName}</span></div>
        <div class="item"><strong>Técnico Asignado</strong><span>${techName}</span></div>
      </div>

      <div class="section-title">DESCRIPCIÓN DEL PROBLEMA</div>
      <div class="description-box">${ticket.description}</div>

      <div class="footer">
        Comprobante de atención generado por HelpDesk EDU el ${new Date().toLocaleString('es-HN')}
      </div>
    </body>
    </html>
  `);

  win.document.close();
  win.focus();

  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

function renderTickets(): void {
  const filter = el<HTMLSelectElement>('statusFilter').value;
  const tickets = filter === 'todos'
    ? ticketsCache
    : ticketsCache.filter(t => t.status === filter);

  const listEl = el<HTMLElement>('ticketList');
  listEl.replaceChildren();

  if (!tickets.length) {
    listEl.append(makeEmpty('No hay tickets para mostrar.'));
    return;
  }

  for (const ticket of tickets) {
    const article = document.createElement('article');
    article.className = 'ticket';

    const top = document.createElement('div');
    top.className = 'ticket-top';

    const titleBox = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = `TICKET #${ticket.id}`;

    const h3 = document.createElement('h3');
    h3.textContent = ticket.title;

    titleBox.append(eyebrow, h3);
    top.append(titleBox, makeBadge(ticket.status, statusClass(ticket.status)));

    const p = document.createElement('p');
    p.textContent = ticket.description;

    const meta = document.createElement('div');
    meta.className = 'ticket-meta';
    meta.append(
      makeBadge(categoryLabel(ticket.category)),
      makeBadge(
        `Prioridad: ${ticket.priority}`,
        ticket.priority === 'Alta' ? 'high'
          : ticket.priority === 'Crítica' ? 'critical' : ''
      ),
      makeBadge(new Date(ticket.created_at).toLocaleString('es-HN')),
    );

    if (isStaff() && ticket.owner?.full_name) {
      meta.append(makeBadge(`Usuario: ${ticket.owner.full_name}`));
    }

    if (ticket.technician?.full_name) {
      meta.append(makeBadge(`Técnico: ${ticket.technician.full_name}`));
    }

    article.append(top, p, meta);

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'staff-actions';

    if (isAdmin() || ticket.technician_id === currentUser?.id) {
      actionsWrapper.append(makeStaffActionsContent(ticket));
    } else if (isStaff()) {
      actionsWrapper.append(makeBadge(
        ticket.technician_id
          ? 'Solo el técnico asignado puede cambiar el estado.'
          : 'Ticket pendiente de asignación.'
      ));
    }

    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'btn-print-pdf';
    printBtn.textContent = 'Imprimir PDF';
    printBtn.addEventListener('click', () => printSingleTicket(ticket));

    actionsWrapper.append(printBtn);
    article.append(actionsWrapper);
    listEl.append(article);
  }
}

function makeStaffActionsContent(ticket: Ticket): HTMLElement {
  const container = document.createElement('div');
  container.className = 'ticket-action-controls';

  const statusGroup = document.createElement('div');
  statusGroup.className = 'status-actions';

  const next = isAdmin()
    ? STATUSES.filter(s => s !== ticket.status)
    : STATUS_FLOW[ticket.status];

  if (!next.length) {
    statusGroup.append(
      makeBadge('Ticket cerrado: solo un administrador puede reabrirlo.')
    );
  } else {
    const select = document.createElement('select');
    select.setAttribute(
      'aria-label',
      `Cambiar estado del ticket ${ticket.id}`
    );
    fillSelect(select, next.map(s => ({ value: s, label: s })));

    const button = document.createElement('button');
    button.className = 'btn secondary';
    button.type = 'button';
    button.textContent = 'Guardar estado';

    button.addEventListener('click', async () => {
      button.disabled = true;
      select.disabled = true;

      try {
        await updateTicketStatus(
          ticket.id,
          select.value as TicketStatus
        );
      } finally {
        button.disabled = false;
        select.disabled = false;
      }
    });

    statusGroup.append(select, button);
  }

  container.append(statusGroup);

  if (isAdmin()) {
    container.append(makeReassignmentControls(ticket));
  }

  return container;
}

function makeReassignmentControls(ticket: Ticket): HTMLElement {
  const group = document.createElement('div');
  group.className = 'reassign-actions';

  const label = document.createElement('label');
  label.className = 'reassign-label';
  label.textContent = 'Reasignar técnico';

  const select = document.createElement('select');
  select.setAttribute(
    'aria-label',
    `Reasignar técnico del ticket ${ticket.id}`
  );

  fillSelect(select, [
    { value: '', label: 'Seleccionar técnico…' },
    ...techniciansCache.map(technician => ({
      value: technician.id,
      label: technician.full_name?.trim() || 'Técnico sin nombre',
    })),
  ], ticket.technician_id ?? '');

  label.append(select);

  const button = document.createElement('button');
  button.className = 'btn secondary btn-reassign';
  button.type = 'button';
  button.textContent = 'Reasignar';
  button.disabled = techniciansCache.length === 0;

  button.addEventListener('click', async () => {
    const technicianId = select.value;

    if (!technicianId) {
      notify('Selecciona un técnico para reasignar el ticket.', 'error');
      return;
    }

    if (technicianId === ticket.technician_id) {
      notify('Ese técnico ya está asignado a este ticket.', 'error');
      return;
    }

    button.disabled = true;
    select.disabled = true;

    try {
      await reassignTicket(ticket.id, technicianId);
    } finally {
      button.disabled = false;
      select.disabled = false;
    }
  });

  if (!techniciansCache.length) {
    const hint = document.createElement('span');
    hint.className = 'reassign-hint';
    hint.textContent = 'No hay técnicos disponibles para asignar.';
    group.append(label, hint);
  } else {
    group.append(label, button);
  }

  return group;
}

async function reassignTicket(
  ticketId: number,
  technicianId: string
): Promise<void> {
  if (!isAdmin()) {
    notify('Solo un administrador puede reasignar tickets.', 'error');
    return;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({ technician_id: technicianId })
    .eq('id', ticketId)
    .select('id');

  if (error) {
    notify(
      friendlyError(error, 'No se pudo reasignar el ticket.'),
      'error'
    );
    return;
  }

  if (!data?.length) {
    notify(
      'No se pudo reasignar el ticket. Verifica el rol de administrador y la política RLS.',
      'error'
    );
    return;
  }

  notify('Ticket reasignado correctamente.');
  await loadTickets();
}

async function updateTicketStatus(
  ticketId: number,
  newStatus: TicketStatus
): Promise<void> {
  if (!isStaff()) {
    notify('No tiene permisos para modificar estados.', 'error');
    return;
  }

  const ticket = ticketsCache.find(item => item.id === ticketId);

  if (!isAdmin() && ticket?.technician_id !== currentUser?.id) {
    notify(
      'Solo el técnico asignado puede modificar el estado de este ticket.',
      'error'
    );
    return;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({ status: newStatus })
    .eq('id', ticketId)
    .select('id');

  if (error) {
    notify(
      friendlyError(error, 'No se pudo actualizar el ticket.'),
      'error'
    );
    return;
  }

  if (!data?.length) {
    notify(
      'La base de datos no permitió el cambio (RLS). Verifique su rol.',
      'error'
    );
    return;
  }

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

  if (error) {
    listEl.replaceChildren(
      makeEmpty(friendlyError(error, 'No se pudo cargar la auditoría.'))
    );
    return;
  }

  const logs = (data ?? []) as unknown as AuditLog[];

  if (!logs.length) {
    listEl.replaceChildren(makeEmpty('Sin cambios registrados todavía.'));
    return;
  }

  listEl.replaceChildren(...logs.map(log => {
    const row = document.createElement('div');
    row.className = 'audit-row';

    const what = log.action === 'CREATE'
      ? `creó el ticket · estado inicial: ${log.new_status ?? 'abierto'}`
      : log.action === 'ASSIGN'
        ? 'asignó técnico'
        : `${log.old_status ?? '-'} → ${log.new_status ?? '-'}`;

    row.textContent =
      `#${log.ticket_id} · ${what} · ${log.actor?.full_name ?? 'sistema'} · ${new Date(log.created_at).toLocaleString('es-HN')}`;

    return row;
  }));
}

let enteredUserId: string | null = null;

async function enterApp(user: User): Promise<void> {
  if (enteredUserId === user.id) return;

  enteredUserId = user.id;
  currentUser = user;

  try {
    await loadProfile();
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    await loadTickets();
  } catch (error) {
    enteredUserId = null;
    notify(friendlyError(error, 'No fue posible cargar el perfil.'), 'error');
    await supabase.auth.signOut();
  }
}

function leaveApp(): void {
  enteredUserId = null;
  currentUser = null;
  currentProfile = null;
  ticketsCache = [];
  techniciansCache = [];
  allUsersCache = [];
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  
  const navAdminUsers = document.getElementById('navAdminUsers');
  if (navAdminUsers) {
    navAdminUsers.classList.add('hidden');
  }

  const userAdminPanel = document.getElementById('adminUsersPanel') || document.getElementById('adminUsersSection');
  if (userAdminPanel) {
    userAdminPanel.classList.add('hidden');
  }
}

function init(): void {
  setupForms();

  if (configError) {
    el<HTMLElement>('configError').textContent = configError;
    el<HTMLElement>('configError').classList.remove('hidden');
    return;
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
      const user = session.user;
      window.setTimeout(() => void enterApp(user), 0);
    }

    if (event === 'SIGNED_OUT') leaveApp();
  });
}

init();