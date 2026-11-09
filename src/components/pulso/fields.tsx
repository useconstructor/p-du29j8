"use client";

import { RefObject, KeyboardEvent } from "react";
import { CircleAlert } from "lucide-react";
import { categories, FieldErrors, RawDraft } from "@/lib/pulso-types";

export function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
  )).filter(node => node.getClientRects().length > 0 && node.getAttribute("aria-hidden") !== "true");
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
}

export function Fields({ prefix, raw, errors, onChange, disabled, nameRef, stacked = false }: {
  prefix: string; raw: RawDraft; errors: FieldErrors; onChange: (raw: RawDraft) => void;
  disabled?: boolean; nameRef?: RefObject<HTMLInputElement | null>; stacked?: boolean;
}) {
  const description = (key: keyof RawDraft) => `${prefix}-${key}-hint${errors[key] ? ` ${prefix}-${key}-error` : ""}`;
  return <div className={`grid gap-4 ${stacked ? "" : "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
    <div className="min-w-0">
      <label className="field-label" htmlFor={`${prefix}-nombre`}>Nombre</label>
      <input ref={nameRef} className="field" id={`${prefix}-nombre`} name="nombre" value={raw.nombre}
        onChange={event => onChange({ ...raw, nombre: event.target.value })} disabled={disabled}
        autoComplete="off" aria-invalid={!!errors.nombre} aria-describedby={description("nombre")} />
      <p className="field-hint" id={`${prefix}-nombre-hint`}>De 1 a 60 caracteres. No sólo espacios.</p>
      <FieldError id={`${prefix}-nombre-error`} message={errors.nombre} />
    </div>
    <div className="min-w-0">
      <label className="field-label" htmlFor={`${prefix}-categoria`}>Categoría</label>
      <select className="field" id={`${prefix}-categoria`} name="categoria" value={raw.categoria}
        onChange={event => onChange({ ...raw, categoria: event.target.value })} disabled={disabled}
        aria-invalid={!!errors.categoria} aria-describedby={description("categoria")}>
        <option value="">Selecciona una categoría</option>
        {categories.map(category => <option key={category} value={category}>{category}</option>)}
      </select>
      <p className="field-hint" id={`${prefix}-categoria-hint`}>Elige el grupo de tu hábito.</p>
      <FieldError id={`${prefix}-categoria-error`} message={errors.categoria} />
    </div>
    <div className="min-w-0">
      <label className="field-label" htmlFor={`${prefix}-meta_semanal`}>Meta semanal</label>
      <input className="field" id={`${prefix}-meta_semanal`} name="meta_semanal" type="text" inputMode="numeric"
        value={raw.meta_semanal} onChange={event => onChange({ ...raw, meta_semanal: event.target.value })}
        disabled={disabled} aria-invalid={!!errors.meta_semanal} aria-describedby={description("meta_semanal")} />
      <p className="field-hint" id={`${prefix}-meta_semanal-hint`}>Entre 1 y 7 días por semana.</p>
      <FieldError id={`${prefix}-meta_semanal-error`} message={errors.meta_semanal} />
    </div>
  </div>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-2 flex items-start gap-2 text-sm text-destructive">
    <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{message}</span>
  </p> : null;
}

export function focusInvalid(prefix: string, errors: FieldErrors) {
  const first = (["nombre", "categoria", "meta_semanal"] as const).find(key => errors[key]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}

export function ValidationSummary({ prefix, errors }: { prefix: string; errors: FieldErrors }) {
  const labels = { nombre: "Nombre", categoria: "Categoría", meta_semanal: "Meta semanal" };
  const invalidFields = (Object.keys(labels) as (keyof RawDraft)[]).filter(key => errors[key]);
  if (!invalidFields.length) return null;
  return <div className="validation-summary" role="alert">
    <p className="flex items-start gap-2 font-semibold">
      <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      Revisa los campos indicados.
    </p>
    <ul className="mt-2">
      {invalidFields.map(key => <li key={key}>
        <button type="button" className="validation-link"
          onClick={() => document.getElementById(`${prefix}-${key}`)?.focus()}>
          {labels[key]}: {errors[key]}
        </button>
      </li>)}
    </ul>
  </div>;
}
