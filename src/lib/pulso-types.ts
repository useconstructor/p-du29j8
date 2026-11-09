export const categories = ["Movimiento", "Calma", "Aprendizaje"] as const;
export type Category = (typeof categories)[number];
export type Habit = {
  id: string; nombre: string; categoria: Category; meta_semanal: number;
  version: number; created_at: string; updated_at: string;
};
export type HabitRecord = { id: string; habito_id: string; fecha: string; created_at: string };
export type Calendar = {
  timeZone: "America/Bogota"; today: string; weekStart: string; weekEnd: string;
  days: string[]; nextMidnight: string;
};
export type Snapshot = { habitos: Habit[]; registros: HabitRecord[]; context: Calendar };
export type RawDraft = { nombre: string; categoria: string; meta_semanal: string };
export type FieldErrors = Partial<Record<keyof RawDraft, string>>;
export type ApiError = {
  code: string; message: string; fields?: Record<string, string>;
  current?: { habito: Habit; registros: HabitRecord[] };
};
export const emptyDraft = (): RawDraft => ({ nombre: "", categoria: "", meta_semanal: "" });
export const draftFrom = (habit: Habit): RawDraft => ({
  nombre: habit.nombre, categoria: habit.categoria, meta_semanal: String(habit.meta_semanal),
});
export function validateDraft(raw: RawDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!raw.nombre.trim() || Array.from(raw.nombre).length > 60)
    errors.nombre = "Escribe un nombre de 1 a 60 caracteres, no sólo espacios.";
  if (!categories.includes(raw.categoria as Category))
    errors.categoria = "Selecciona Movimiento, Calma o Aprendizaje.";
  if (!/^[1-7]$/.test(raw.meta_semanal))
    errors.meta_semanal = "Escribe un número entero entre 1 y 7.";
  return errors;
}
export const isValid = (raw: RawDraft) => Object.keys(validateDraft(raw)).length === 0;
export const sameDraft = (a: RawDraft, b: RawDraft) =>
  a.nombre === b.nombre && a.categoria === b.categoria && a.meta_semanal === b.meta_semanal;
export const editablePayload = (raw: RawDraft) => ({
  nombre: raw.nombre, categoria: raw.categoria as Category, meta_semanal: Number(raw.meta_semanal),
});
// Dates are supplied by the server. UTC here formats a date-only value without
// allowing the browser's time zone to shift its calendar day.
export function formatDate(date: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", ...options })
    .format(new Date(`${date}T12:00:00Z`));
}
export const fullDate = (date: string) => formatDate(date, {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});
