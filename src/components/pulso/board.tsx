"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, CircleAlert, Pencil, Trash2, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { pulso, Operation } from "@/lib/pulso-store";
import { Calendar, Habit, Snapshot, draftFrom, formatDate, fullDate, isValid, validateDraft } from "@/lib/pulso-types";
import { AddHabit, usePulso } from "./shell";
import { Fields, trapTab, ValidationSummary } from "./fields";

const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function Board({ week = false }: { week?: boolean }) {
  const state = usePulso();
  const data = state.sessionProblem ? null : state.snapshot;
  return <>
    <div className="mb-6 flex min-h-16 items-center justify-between gap-4 max-sm:mb-3 max-sm:min-h-11">
      <div>
        <h1 className="text-[32px] leading-tight font-semibold max-sm:text-[28px]">{week ? "Semana" : "Hoy"}</h1>
        <p className="mt-2 text-muted-foreground max-sm:hidden">
          {week ? "Revisa tus marcas y el progreso de cada hábito." : "Marca lo que hiciste hoy. Cada pulso confirma tu avance."}
        </p>
      </div>
      {week ? <Link className="action-secondary" href="/">Ir a Hoy</Link> : <AddHabit />}
    </div>
    {state.loading && <section aria-label="Cargando hábitos" className="space-y-4" role="status">
      <div className="grid h-36 grid-cols-7 gap-3 rounded border border-border bg-white p-4 max-sm:h-20">
        {days.map(day => <div key={day} className="rounded bg-background" />)}
      </div>
      <p className="py-6 text-muted-foreground">Cargando tus hábitos…</p>
    </section>}
    {data && <>
      <WeekBand data={data} week={week} />
      {state.refreshing && <p className="mt-3 text-sm text-muted-foreground" role="status">Actualizando la vista…</p>}
      {data.habitos.length === 0 ? <section className="empty-state" aria-label="Sin hábitos">
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold">Todavía no tienes hábitos</h2>
          <p className="mb-6 mt-3 leading-relaxed text-muted-foreground">
            {week ? "Añade tu primer hábito desde Hoy. Aquí verás tus marcas de cada día y tu progreso semanal."
              : "Empieza con uno pequeño. Puedes editarlo después o cambiar tu meta semanal."}
          </p>
          {week ? <Link className="action-primary" href="/">Ir a Hoy</Link> : <AddHabit />}
        </div>
      </section> : <div className="mt-4 space-y-3">
        {data.habitos.map(habit => <HabitRow key={habit.id} habit={habit} data={data} week={week} />)}
      </div>}
      {week && <><p className="mt-4 text-sm text-muted-foreground">Las fechas futuras se muestran para completar la semana; todavía no se pueden marcar.</p><Summary data={data} /></>}
    </>}
  </>;
}

function WeekBand({ data, week }: { data: Snapshot; week: boolean }) {
  return <section aria-label="Esta semana" className="overflow-hidden rounded border border-border bg-white">
    <div className={week ? "week-grid p-4 max-sm:p-2" : "p-4 max-sm:p-2"}>
      {week && <div className="hidden self-center pr-4 sm:block">
        <p className="font-semibold">Tus hábitos</p>
        <p className="mt-1 text-sm text-muted-foreground">Marcas confirmadas</p>
      </div>}
      <div className="seven-grid">
        {data.context.days.map((date, index) => {
          const count = data.registros.filter(record => record.fecha === date).length;
          const completed = data.habitos.length > 0 && data.habitos.every(habit =>
            data.registros.some(record => record.habito_id === habit.id && record.fecha === date));
          const today = date === data.context.today;
          return <div key={date} className={`day-column ${today ? "is-today" : ""}`}
            aria-label={`${fullDate(date)}, ${count} marcas${today ? ", hoy" : ""}${completed ? ", día completado" : ""}`}>
            <span className="text-sm font-medium max-sm:text-xs">{days[index]}</span>
            <span className="mt-1 text-xs">{formatDate(date, { day: "numeric", month: "short" }).replace(".", "")}</span>
            <span className={`day-indicator ${completed ? "is-complete" : ""}`} aria-hidden="true">
              {completed ? <Check size={17} /> : <span className="text-xs sm:hidden">{count}</span>}
            </span>
            <span className="text-sm tabular-nums max-sm:hidden">{count}</span>
            <span className="sr-only">{completed ? "Completado" : "Pendiente"}</span>
          </div>;
        })}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground max-sm:hidden">
      <p className="flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" />
        Semana del {formatDate(data.context.weekStart, { day: "numeric", month: "long" })} al {formatDate(data.context.weekEnd, { day: "numeric", month: "long" })} · Bogotá
      </p>
      <p>Hoy, {formatDate(data.context.today, { weekday: "long", day: "numeric", month: "long" })}</p>
    </div>
  </section>;
}

function HabitRow({ habit, data, week }: { habit: Habit; data: Snapshot; week: boolean }) {
  const state = usePulso();
  const edit = state.edits[habit.id];
  const op = state.operations[habit.id];
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resolveDelete, setResolveDelete] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const editorName = useRef<HTMLInputElement>(null);
  const wasEditorOpen = useRef(false);
  const count = data.registros.filter(record => record.habito_id === habit.id).length;
  const busy = !!op && op.status !== "rejected";
  const errors = edit ? validateDraft(edit.raw) : {};
  useEffect(() => {
    if (edit?.open && !wasEditorOpen.current) editorName.current?.focus();
    wasEditorOpen.current = !!edit?.open;
  }, [edit?.open]);
  const requestDelete = () => {
    pulso.consumeFocus();
    if (edit?.dirty) {
      pulso.pauseEdit(habit.id);
      setResolveDelete(true);
    } else setDeleteOpen(true);
  };
  return <section aria-label={`Hábito ${habit.nombre}`} data-habit-id={habit.id}
    className="habit-row rounded border border-border bg-white">
    <div className={week ? "week-grid items-center p-4 max-sm:p-3" : "flex items-center gap-4 p-5 max-sm:flex-wrap max-sm:gap-3 max-sm:p-4"}>
      <div className={week ? "min-w-0 pr-4 max-sm:pr-0" : "min-w-0 flex-1 basis-40"}>
        <h2 className="habit-name whitespace-pre-wrap break-words text-lg leading-snug font-semibold">{habit.nombre}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{habit.categoria} <span aria-hidden="true">·</span> Meta: {habit.meta_semanal} {habit.meta_semanal === 1 ? "día" : "días"}</p>
        {week && <p className="mt-1 text-sm text-muted-foreground">{count} / {habit.meta_semanal} días esta semana</p>}
        {week && <div className="mt-2 flex gap-1">
          <button id={`habit-action-${habit.id}`} type="button" className="action-quiet" aria-label={`Editar ${habit.nombre}`}
            aria-expanded={!!edit?.open} aria-controls={`editor-${habit.id}`} onClick={() => pulso.openEdit(habit)}>
            <Pencil size={15} aria-hidden="true" />Editar
          </button>
          <button ref={deleteTrigger} type="button" className="action-icon" aria-label={`Eliminar ${habit.nombre}`}
            disabled={busy || !!state.error} onClick={requestDelete}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>}
      </div>
      {week ? <div className="seven-grid max-sm:mt-4">
        {data.context.days.map(date => <Mark key={date} habit={habit} date={date} calendar={data.context}
          completed={data.registros.some(record => record.habito_id === habit.id && record.fecha === date)} />)}
      </div> : <>
        <Mark habit={habit} date={data.context.today} calendar={data.context} showText
          completed={data.registros.some(record => record.habito_id === habit.id && record.fecha === data.context.today)} />
        <div className="flex gap-1 max-sm:ml-auto">
          <button id={`habit-action-${habit.id}`} type="button" className="action-icon" aria-label={`Editar ${habit.nombre}`}
            aria-expanded={!!edit?.open} aria-controls={`editor-${habit.id}`} onClick={() => pulso.openEdit(habit)}>
            <Pencil size={18} aria-hidden="true" />
          </button>
          <button ref={deleteTrigger} type="button" className="action-icon" aria-label={`Eliminar ${habit.nombre}`}
            disabled={busy || !!state.error} onClick={requestDelete}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </>}
    </div>
    {op && !(op.kind === "edit" && edit?.open) && !(op.kind === "delete" && deleteOpen) &&
      <div className="border-t border-border px-5 py-4 max-sm:px-4"><OperationFeedback id={habit.id} op={op} /></div>}
    {edit?.open && <section id={`editor-${habit.id}`} aria-label={`Editar ${habit.nombre}`}
      className="border-t border-border bg-background/40 p-5 max-sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Editar hábito</h3>
        <button className="action-icon" aria-label={`Cerrar editor de ${habit.nombre}`} onClick={() => {
          pulso.openEdit(habit); document.getElementById(`habit-action-${habit.id}`)?.focus();
        }}><X size={18} /></button>
      </div>
      <Fields prefix={`edit-${habit.id}`} raw={edit.raw} errors={errors} nameRef={editorName}
        onChange={raw => pulso.changeEdit(habit.id, raw)} />
      <ValidationSummary prefix={`edit-${habit.id}`} errors={errors} />
      {!op && <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" role="status">
          {edit.dirty ? "Cambios sin guardar" : "Guardado"}
        </p>
        {edit.hold ? <button className="action-secondary" onClick={() => void pulso.prepare(habit.id)}>Preparar nuevos cambios</button> :
          <p className="text-sm text-muted-foreground">Los cambios válidos se guardan automáticamente.</p>}
      </div>}
      {op?.kind === "edit" && <div className="mt-4"><OperationFeedback id={habit.id} op={op} /></div>}
    </section>}
    {resolveDelete && <div className="notice m-4 space-y-3" role="alert">
      <p>Hay cambios sin guardar. Puedes seguir editando o descartarlos antes de eliminar.</p>
      <div className="flex flex-wrap gap-3">
        <button className="action-secondary" onClick={() => {
          setResolveDelete(false); void pulso.prepare(habit.id);
        }}>Seguir editando</button>
        <button className="action-secondary" disabled={busy} onClick={() => {
          pulso.discard(habit.id); setResolveDelete(false); setDeleteOpen(true);
        }}>Descartar cambios y continuar</button>
      </div>
    </div>}
    <AlertDialog open={deleteOpen} onOpenChange={open => {
      if (!open && op && ["pending", "uncertain"].includes(op.status)) return;
      setDeleteOpen(open);
    }}>
      <AlertDialogContent className="pulso-modal" initialFocus={cancelDelete}
        finalFocus={() => {
          const target = pulso.getSnapshot().focusTarget;
          if (target === "add") return document.querySelector<HTMLElement>("[data-add-habit]");
          return (target ? document.getElementById(`habit-action-${target}`) : null) || deleteTrigger.current;
        }} onKeyDown={trapTab}>
        <AlertDialogTitle className="whitespace-pre-wrap [overflow-wrap:anywhere] text-xl font-semibold">¿Eliminar «{habit.nombre}»?</AlertDialogTitle>
        <AlertDialogDescription className="text-base">También se eliminarán sus registros.</AlertDialogDescription>
        {op?.kind === "delete" && <OperationFeedback id={habit.id} op={op} />}
        <div className="flex flex-wrap justify-end gap-3">
          <button ref={cancelDelete} className="action-secondary" disabled={op?.status === "pending" || op?.status === "uncertain"}
            onClick={() => setDeleteOpen(false)}>Cancelar</button>
          <button className="action-danger" disabled={!!op} onClick={async () => {
            if (await pulso.delete(habit)) setDeleteOpen(false);
          }}>Eliminar hábito</button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function Mark({ habit, date, calendar, completed, showText = false }: {
  habit: Habit; date: string; calendar: Calendar; completed: boolean; showText?: boolean;
}) {
  const state = usePulso();
  const button = useRef<HTMLButtonElement>(null);
  const pulse = state.pulses[`${habit.id}:${date}`] ?? 0;
  const previousPulse = useRef(pulse);
  const animation = useRef<Animation | null>(null);
  const future = date > calendar.today;
  const op = state.operations[habit.id];
  const pending = op?.kind === "mark" && op.payload.fecha === date && op.status === "pending";
  const blocked = future || !!op || !!state.edits[habit.id]?.dirty || !!state.error || state.sessionProblem;
  useEffect(() => {
    if (previousPulse.current !== pulse) {
      previousPulse.current = pulse;
      animation.current?.cancel();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        animation.current = button.current?.querySelector("[data-mark-indicator]")?.animate(
          [{ transform: "scale(0.85)" }, { transform: "scale(1)" }],
          { duration: 160, easing: "ease-out" },
        ) ?? null;
    }
    return () => animation.current?.cancel();
  }, [pulse]);
  return <div className="flex min-w-0 flex-col items-center justify-center">
    {!showText && <span className="mb-1 text-center text-xs leading-tight text-muted-foreground sm:hidden" aria-hidden="true">
      <span className="block">{formatDate(date, { weekday: "short" }).replace(".", "")}</span>
      <span className="block">{formatDate(date, { day: "numeric", month: "numeric" })}</span>
    </span>}
    <button ref={button} id={`habit-mark-${habit.id}-${date}`} type="button" className={`mark-control ${showText ? "has-text" : ""}`}
      aria-pressed={completed}
      aria-label={`${completed ? "Desmarcar" : "Marcar"} ${habit.nombre}, ${fullDate(date)}, ${completed ? "Completado" : "Pendiente"}`}
      aria-describedby={future ? `future-${habit.id}-${date}` : undefined}
      title={future ? "Fecha futura" : undefined}
      aria-busy={pending}
      disabled={future} aria-disabled={blocked}
      onClick={() => { if (!blocked) void pulso.mark(habit, date, !completed); }}>
      <span data-mark-indicator className={`mark-indicator ${completed ? "is-complete" : ""}`} aria-hidden="true">
        {completed && <Check size={18} strokeWidth={2.5} />}
      </span>
      {showText && <span className="text-sm max-sm:hidden">{completed ? "Completado" : "Pendiente"}</span>}
    </button>
    {future && <span id={`future-${habit.id}-${date}`} className="sr-only">Fecha futura</span>}
  </div>;
}

function OperationFeedback({ id, op }: { id: string; op: Operation }) {
  const state = usePulso();
  const edit = state.edits[id];
  const date = typeof op.payload.fecha === "string" ? op.payload.fecha : null;
  const retry = async (trigger: HTMLButtonElement) => {
    const restoreMark = op.kind === "mark" && date && document.activeElement === trigger;
    if (await pulso.retry(id) && restoreMark) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === trigger)
          document.getElementById(`habit-mark-${id}-${date}`)?.focus();
      });
    }
  };
  if (op.status === "pending") return <p role="status" className="text-sm">
    Guardando{date ? ` · ${fullDate(date)}` : ""}
    {op.kind === "edit" && edit && edit.revision !== op.revision ? " · Cambios sin guardar en la edición más reciente" : ""}
  </p>;
  if (op.status === "uncertain") return <div role="alert" className="space-y-3">
    <p className="flex items-start gap-2 font-semibold"><CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />No se pudo confirmar el resultado</p>
    <p className="text-sm text-muted-foreground">Conservamos el envío y la última confirmación. Reintenta para recuperar el resultado antes de continuar.</p>
    {date && <p className="text-sm">{fullDate(date)} · {op.payload.completado ? "Marcar" : "Desmarcar"}</p>}
    {op.kind === "edit" && <p className="text-sm whitespace-pre-wrap break-words">Envío anterior: {String(op.payload.nombre)} · {String(op.payload.categoria)} · Meta {String(op.payload.meta_semanal)}</p>}
    <div className="flex flex-wrap gap-3">
      <button className="action-secondary" onClick={event => void retry(event.currentTarget)}>Reintentar</button>
      {edit?.dirty && <><button className="action-quiet" onClick={event => void retry(event.currentTarget)}>Recuperar envío anterior</button>
        <button className="action-secondary" onClick={() => void pulso.prepare(id)}>Preparar nuevos cambios</button></>}
    </div>
  </div>;
  if (op.status === "conflict" && op.error?.current) {
    const current = op.error.current;
    const previous = op.before;
    const desired = edit?.raw ?? (previous ? draftFrom(previous) : null);
    return <div role="alert" className="space-y-4">
      <p className="flex items-start gap-2 font-semibold"><CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />Hay cambios en otra vista</p>
      <p className="text-sm">Elige cómo continuar. Tu edición se mantiene aquí.</p>
      <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
        <div><dt className="mb-1 font-semibold">Tu borrador</dt><dd className="whitespace-pre-wrap break-words">{desired?.nombre} · {desired?.categoria} · Meta {desired?.meta_semanal}</dd>
          {date && <dd className="mt-1">{fullDate(date)}: {op.payload.completado ? "Marcar" : "Desmarcar"}</dd>}
        </div>
        <div><dt className="mb-1 font-semibold">Valores actuales</dt><dd className="whitespace-pre-wrap break-words">{current.habito.nombre} · {current.habito.categoria} · Meta {current.habito.meta_semanal}</dd>
          {date && <dd className="mt-1">{fullDate(date)}: {current.registros.some(record => record.fecha === date) ? "Completado" : "Pendiente"}</dd>}
        </div>
        <div><dt className="mb-1 font-semibold">Última confirmación</dt><dd className="whitespace-pre-wrap break-words">{previous?.nombre} · {previous?.categoria} · Meta {previous?.meta_semanal}</dd>
          {date && <dd className="mt-1">{fullDate(date)}: {state.snapshot?.registros.some(record => record.habito_id === id && record.fecha === date) ? "Completado" : "Pendiente"}</dd>}
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <button className="action-secondary" onClick={() => pulso.useCurrent(id)}>Usar valores actuales</button>
        <button className="action-primary" disabled={op.kind === "edit" && (!edit || !isValid(edit.raw))}
          onClick={() => void pulso.overwrite(id)}>Guardar mis cambios</button>
      </div>
    </div>;
  }
  return <div role="alert" className="space-y-3">
    <p className="flex items-start gap-2"><CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />{op.error?.message || "No se pudo completar la solicitud."}</p>
    {op.error?.fields && <ul className="list-disc pl-5 text-sm">{Object.entries(op.error.fields).map(([field, message]) =>
      <li key={field}>{message}</li>)}</ul>}
    <button className="action-secondary" onClick={() => {
      pulso.clearRejected(id); void pulso.refresh();
    }}>Reintentar</button>
  </div>;
}

function Summary({ data }: { data: Snapshot }) {
  const counts = data.context.days.map((date, index) => ({
    date, day: days[index], count: data.registros.filter(record => record.fecha === date).length,
  }));
  const goal = data.habitos.reduce((total, habit) => total + habit.meta_semanal, 0);
  const reached = data.habitos.reduce((total, habit) => total + Math.min(
    habit.meta_semanal, data.registros.filter(record => record.habito_id === habit.id).length,
  ), 0);
  return <section className="mt-8 border-t border-border pt-8" aria-label="Resumen semanal">
    <h2 className="text-2xl font-semibold">Tu semana, hasta hoy</h2>
    <div className="my-5 flex flex-wrap gap-x-12 gap-y-4">
      <p><span className="block text-[28px] font-semibold tabular-nums">{data.registros.length}</span><span className="text-sm text-muted-foreground">Marcas confirmadas</span></p>
      <p><span className="block text-[28px] font-semibold tabular-nums">{goal ? `${Math.round(reached / goal * 100)} %` : "Sin metas"}</span>
        <span className="text-sm text-muted-foreground">{goal ? `${reached} de ${goal} días de tus metas` : "Añade tu primer hábito desde Hoy"}</span></p>
    </div>
    <p className="mb-6 text-sm text-muted-foreground">Cada hábito aporta hasta su propia meta. Las marcas adicionales se incluyen en el recuento total.</p>
    <section aria-label="Marcas por día" className="rounded border border-border bg-white p-6 max-sm:p-4">
      <h3 className="mb-6 font-semibold">Marcas por día</h3>
      <ChartContainer config={{ count: { label: "Marcas", color: "var(--brand-primary)" } }} className="h-52 w-full">
        <BarChart accessibilityLayer data={counts} margin={{ left: -24, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={10} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} domain={[0, Math.max(1, data.habitos.length)]} />
          <Bar dataKey="count" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <ul className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-7" aria-label="Recuento diario">
        {counts.map(item => <li key={item.date}><span className="block text-muted-foreground">{formatDate(item.date, { weekday: "long", day: "numeric" })}</span>
          <span className="mt-1 block">{item.count} {item.count === 1 ? "marca" : "marcas"}</span></li>)}
      </ul>
    </section>
  </section>;
}
