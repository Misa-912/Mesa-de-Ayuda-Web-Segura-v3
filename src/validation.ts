import { CATEGORIES, LIMITS, PRIORITIES } from './types';
import type { TicketCategory, TicketPriority } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_CATEGORIES = new Set<string>(CATEGORIES.map(c => c.value));
const ALLOWED_PRIORITIES = new Set<string>(PRIORITIES);

export function validateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error('Ingrese un correo electrónico válido.');
  return email;
}

export function validatePassword(value: string): string {
  if (value.length < LIMITS.passwordMin || value.length > LIMITS.passwordMax) {
    throw new Error(`La contraseña debe tener entre ${LIMITS.passwordMin} y ${LIMITS.passwordMax} caracteres.`);
  }
  return value;
}

export function validateName(value: string): string {
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < LIMITS.nameMin || result.length > LIMITS.nameMax) {
    throw new Error(`El nombre debe tener entre ${LIMITS.nameMin} y ${LIMITS.nameMax} caracteres.`);
  }
  return result;
}

export function validateTicket(input: { title: string; description: string; category: string; priority: string }) {
  const title = input.title.trim().replace(/\s+/g, ' ');
  const description = input.description.trim();
  if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) {
    throw new Error(`El asunto debe tener entre ${LIMITS.titleMin} y ${LIMITS.titleMax} caracteres (tiene ${title.length}).`);
  }
  if (description.length < LIMITS.descriptionMin || description.length > LIMITS.descriptionMax) {
    throw new Error(`La descripción debe tener entre ${LIMITS.descriptionMin} y ${LIMITS.descriptionMax} caracteres (tiene ${description.length}).`);
  }
  if (!ALLOWED_CATEGORIES.has(input.category)) throw new Error('Categoría no válida.');
  if (!ALLOWED_PRIORITIES.has(input.priority)) throw new Error('Prioridad no válida.');
  return { title, description, category: input.category as TicketCategory, priority: input.priority as TicketPriority };
}

// Traduce errores de Supabase/PostgreSQL a mensajes entendibles.
// Así el estudiante sabe si el problema es de validación, de permisos (RLS) o de configuración.
export function friendlyError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const e = error as { code?: string; message?: string };
  switch (e.code) {
    case '23514': return 'La base de datos rechazó los datos: no cumplen las reglas (longitud, categoría, prioridad o estado).';
    case '23505': return 'El registro ya existe.';
    case '23503': return 'El registro hace referencia a un dato que no existe (¿falta el perfil del usuario?).';
    case '42501': return 'Permiso denegado por la base de datos (RLS). Verifique su rol.';
    case 'PGRST116': return 'No se encontró el registro o no tiene permiso para verlo.';
    case 'P0001': return e.message ?? fallback; // Mensajes de los triggers de database.sql
  }
  if (e.message?.includes('Failed to fetch')) return 'No hay conexión con Supabase. Revise VITE_SUPABASE_URL en .env.';
  if (e.message?.includes('Invalid API key')) return 'La clave de Supabase no es válida. Revise VITE_SUPABASE_PUBLISHABLE_KEY en .env.';
  if (e.message?.includes('Database error saving new user')) return 'Supabase no pudo crear el perfil. Ejecute de nuevo database.sql (v3).';
  if (e.message?.includes('User already registered')) return 'Ese correo ya está registrado. Inicie sesión.';
  if (e.message?.includes('Email not confirmed')) return 'Debe confirmar su correo antes de iniciar sesión.';
  return e.message ?? fallback;
}
