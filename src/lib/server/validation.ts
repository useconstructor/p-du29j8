import "server-only";
import { invalid } from "./http";
import { validDate } from "./calendar";

export const CATEGORIES = ["Movimiento", "Calma", "Aprendizaje"] as const;
export type Category = typeof CATEGORIES[number];
export type Fields = { nombre: string; categoria: Category; meta_semanal: number };
export type Operation = {
  clave: string; version?: number; nombre?: string; categoria?: Category;
  meta_semanal?: number; fecha?: string; completado?: boolean;
};
export type Kind = "create" | "edit" | "delete" | "record";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateId(id: string) {
  if (!uuid.test(id)) invalid({ id: "El identificador debe ser un UUID válido." });
}

export function validate(input: Record<string, unknown>, kind: Kind): Operation {
  const allowed = kind === "create" ? ["nombre", "categoria", "meta_semanal", "clave"]
    : kind === "edit" ? ["nombre", "categoria", "meta_semanal", "version", "clave"]
    : kind === "delete" ? ["version", "clave"] : ["fecha", "completado", "version", "clave"];
  const errors: Record<string, string> = Object.create(null);
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) errors[field] = "Este campo no está permitido.";
  }
  for (const field of allowed) {
    if (!Object.hasOwn(input, field)) errors[field] = "Este campo es obligatorio.";
  }
  if (typeof input.clave !== "string" || !uuid.test(input.clave)) errors.clave = "Usa una clave UUID válida.";
  if (kind !== "create" && (typeof input.version !== "number" ||
      !Number.isSafeInteger(input.version) || input.version < 1)) {
    errors.version = "La versión debe ser un entero positivo.";
  }
  if (kind === "create" || kind === "edit") {
    if (typeof input.nombre !== "string" || !input.nombre.trim() ||
        Array.from(input.nombre).length > 60) errors.nombre = "Escribe un nombre de 1 a 60 caracteres, no sólo espacios.";
    if (!CATEGORIES.includes(input.categoria as Category)) errors.categoria = "Elige Movimiento, Calma o Aprendizaje.";
    if (typeof input.meta_semanal !== "number" || !Number.isInteger(input.meta_semanal) ||
        input.meta_semanal < 1 || input.meta_semanal > 7) errors.meta_semanal = "La meta debe ser un entero de 1 a 7.";
  }
  if (kind === "record") {
    if (!validDate(input.fecha)) errors.fecha = "Usa una fecha válida con formato AAAA-MM-DD.";
    if (typeof input.completado !== "boolean") errors.completado = "Indica un estado verdadero o falso.";
  }
  if (Object.keys(errors).length) invalid(errors);
  // Copy only a fixed, ordered set; do not normalize accepted field text.
  return Object.fromEntries(allowed.map((field) => [field, input[field]])) as Operation;
}
