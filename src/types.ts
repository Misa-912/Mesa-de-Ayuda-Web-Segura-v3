// Listas oficiales. DEBEN coincidir con los CHECK de database.sql.
// El formulario se construye a partir de estas listas (main.ts), por lo que
// para agregar una categoría se cambia aquí Y en database.sql, nunca solo en el HTML.
export const CATEGORIES = [
  { value: 'Acceso', label: 'Acceso' },
  { value: 'Hardware', label: 'Hardware' },
  { value: 'Software', label: 'Software' },
  { value: 'Red', label: 'Red / Internet' },
  { value: 'Otro', label: 'Otro' },
] as const;

export const PRIORITIES = ['Baja', 'Media', 'Alta', 'Crítica'] as const;
export const STATUSES = ['Abierto', 'En proceso', 'Resuelto', 'Cerrado'] as const;

// Mismo flujo que la función enforce_ticket_update() de database.sql.
// El admin puede hacer cualquier cambio.
export const STATUS_FLOW: Record<TicketStatus, readonly TicketStatus[]> = {
  'Abierto': ['En proceso', 'Cerrado'],
  'En proceso': ['Resuelto'],
  'Resuelto': ['En proceso', 'Cerrado'],
  'Cerrado': [],
};

export const LIMITS = {
  nameMin: 3, nameMax: 100,
  passwordMin: 8, passwordMax: 72,
  titleMin: 5, titleMax: 150,
  descriptionMin: 10, descriptionMax: 1500,
} as const;

export type UserRole = 'usuario' | 'tecnico' | 'admin';
export type TicketStatus = typeof STATUSES[number];
export type TicketPriority = typeof PRIORITIES[number];
export type TicketCategory = typeof CATEGORIES[number]['value'];

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
}

export interface Ticket {
  id: number;
  user_id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  technician_id: string | null;
  created_at: string;
  updated_at: string;
  owner?: { full_name: string } | null;
  technician?: { full_name: string } | null;
}

export interface AuditLog {
  id: number;
  ticket_id: number;
  action: 'STATUS_CHANGE' | 'ASSIGN';
  old_status: TicketStatus | null;
  new_status: TicketStatus | null;
  created_at: string;
  actor?: { full_name: string } | null;
}
