"use client";

import { CSSProperties, ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleAlert, ExternalLink, Menu, Plus, RefreshCw, X } from "lucide-react";
import branding from "../../../branding.json";
import { pulso } from "@/lib/pulso-store";
import { validateDraft } from "@/lib/pulso-types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Fields, focusInvalid, trapTab, ValidationSummary } from "./fields";

export function usePulso() {
  return useSyncExternalStore(pulso.subscribe, pulso.getSnapshot, pulso.getServerSnapshot);
}

export function AddHabit({ className = "" }: { className?: string }) {
  const state = usePulso();
  return <button type="button" className={`action-primary ${className}`} data-add-habit
    disabled={state.loading || !!state.error || state.sessionProblem}
    onClick={() => {
      createTrigger = document.activeElement as HTMLElement;
      pulso.openCreate();
      (window as Window & { constructorTrack?: (event: string) => void }).constructorTrack?.("Habit creation opened");
    }}>
    <Plus size={18} aria-hidden="true" /><span>Añadir hábito</span>
  </button>;
}
let createTrigger: HTMLElement | null = null;

export function PulsoShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const state = usePulso();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const restartCancel = useRef<HTMLButtonElement>(null);
  const restartTrigger = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const focusedTarget = useRef<string | null>(null);
  const directUrl = path === "/semana" ? "/semana" : "/";

  useEffect(() => { pulso.navigate(path); }, [path]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === "visible") void pulso.refresh(); };
    const visible = () => { if (document.visibilityState === "visible") void pulso.refresh(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pulso.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  const nextMidnight = state.snapshot?.context.nextMidnight;
  useEffect(() => {
    if (!nextMidnight) return;
    const delay = Math.max(1, Date.parse(nextMidnight) - Date.now());
    const timer = setTimeout(() => void pulso.refresh(), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [nextMidnight]);
  useEffect(() => {
    if (mobileOpen) nav.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.focus();
  }, [mobileOpen]);
  useEffect(() => {
    if (!state.focusTarget) { focusedTarget.current = null; return; }
    if (!state.focusTarget || state.create.open) return;
    if (focusedTarget.current === state.focusTarget) return;
    // Ref/effect runs after the actual row DOM has mounted.
    const target = state.focusTarget === "add"
      ? document.querySelector<HTMLElement>("[data-add-habit]")
      : document.getElementById(`habit-action-${state.focusTarget}`);
    if (target) { target.focus(); focusedTarget.current = state.focusTarget; }
  }, [state.focusTarget, state.create.open, state.snapshot]);

  return <div className="flex min-h-dvh flex-col" style={{
    "--brand-font-heading": branding.fontHeading,
    "--brand-font-body": branding.fontBody,
  } as CSSProperties}>
    <a href="#workspace" className="skip-link">Saltar al contenido</a>
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex min-h-18 max-w-[1120px] items-center gap-10 px-6 max-sm:min-h-14 max-sm:gap-3 max-sm:px-4 xl:px-0">
        <Link href="/" className="brand-lockup" aria-label={`${branding.logoText}, Hoy`}>
          {/* The exact canonical mark remains replaceable by the supplied branding URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-brand-logo src={branding.logoImageUrl || "/brand-mark.svg"} width={32} height={32} alt="" />
          <span>{branding.logoText}</span>
        </Link>
        <nav ref={nav} aria-label="Vistas" id="view-navigation"
          className={`view-navigation ${mobileOpen ? "is-open" : ""}`}
          onKeyDown={event => {
            if (event.key === "Escape" && mobileOpen) {
              setMobileOpen(false); menuTrigger.current?.focus();
            }
          }}>
          {[["/", "Hoy"], ["/semana", "Semana"]].map(([href, title]) =>
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}
              onClick={() => {
                setMobileOpen(false);
                if (path === href) void pulso.refresh();
              }}>{title}</Link>)}
        </nav>
        <p className="ml-auto hidden text-sm text-muted-foreground md:block">Demo ficticia de Esteban</p>
        <button ref={menuTrigger} className="action-icon ml-auto sm:hidden" type="button"
          aria-label={mobileOpen ? "Cerrar navegación" : "Abrir navegación"}
          aria-controls="view-navigation" aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(value => !value)}>
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
    <main id="workspace" tabIndex={-1} className="mx-auto w-full max-w-[1120px] flex-1 px-6 pb-12 pt-10 outline-none max-sm:px-4 max-sm:pt-4 xl:px-0">
      {children}
      {state.error && <section aria-label="Recuperar acceso" className="notice mt-6" role="alert">
        <div className="flex items-start gap-3">
          <CircleAlert size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-3">
            <h2 className="text-lg font-semibold">{state.sessionProblem ? "No podemos acceder a tus hábitos" : "No se pudo actualizar la vista"}</h2>
            <p>{state.error}</p>
            {state.snapshot && !state.sessionProblem && <p>La vista conserva la última información confirmada.</p>}
            {state.sessionProblem && <p>El acceso directo puede usar un contexto distinto al de esta ventana integrada. No recupera por sí solo tus hábitos.</p>}
            <div className="flex flex-wrap gap-3">
              <button className="action-secondary" disabled={state.refreshing} onClick={() => void pulso.refresh()}>
                <RefreshCw size={16} aria-hidden="true" />Reintentar
              </button>
              {state.sessionProblem && <>
                <a className="action-secondary" href={directUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={16} aria-hidden="true" />Abrir directamente
                </a>
                <button ref={restartTrigger} className="action-quiet" onClick={() => setRestartOpen(true)}>Comenzar un contexto nuevo</button>
              </>}
            </div>
          </div>
        </div>
      </section>}
    </main>
    <footer className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-6 text-sm text-muted-foreground max-sm:px-4 xl:px-0">
      <p className="md:hidden">Demo ficticia de Esteban</p>
      <p>Tus hábitos, día a día.</p>
      <p>Hoy y Semana</p>
    </footer>
    <div className="sr-only" role="status" aria-live="polite">{state.announcement}</div>
    <CreateHabit />
    <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
      <AlertDialogContent className="pulso-modal" initialFocus={restartCancel} finalFocus={restartTrigger} onKeyDown={trapTab}>
        <AlertDialogTitle className="text-xl font-semibold">¿Comenzar un contexto nuevo?</AlertDialogTitle>
        <AlertDialogDescription className="text-base">
          Sólo hazlo si no puedes recuperar el acceso anterior. El nuevo contexto estará vacío y no recuperará los hábitos de la sesión perdida. Los borradores de esta ventana se descartarán.
        </AlertDialogDescription>
        {Object.values(state.operations).some(op => op.status === "pending" || op.status === "uncertain") &&
          <p>Un envío sin confirmar podría haberse guardado en el contexto anterior. Comenzar de nuevo no permite recuperar su resultado.</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button ref={restartCancel} className="action-secondary" onClick={() => setRestartOpen(false)}>Cancelar</button>
          <button className="action-primary" onClick={() => { setRestartOpen(false); void pulso.refresh(true); }}>Comenzar de nuevo</button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function CreateHabit() {
  const state = usePulso();
  const nameRef = useRef<HTMLInputElement>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const create = state.create;
  const op = state.operations.create;
  const errors = create.attempted ? validateDraft(create.raw) : {};
  const protectedOperation = op?.status === "pending" || op?.status === "uncertain";
  const recoveredId = create.recovered?.id;
  useEffect(() => {
    if (recoveredId) nameRef.current?.focus();
  }, [recoveredId]);
  useEffect(() => {
    if (validationAttempt) focusInvalid("create", validateDraft(pulso.getSnapshot().create.raw));
  }, [validationAttempt]);
  return <Dialog open={create.open} onOpenChange={open => { if (!open) pulso.closeCreate(); }}>
    <DialogContent className="pulso-modal create-modal p-6 text-base data-open:animate-none data-closed:animate-none" showCloseButton={false} initialFocus={nameRef}
      finalFocus={() => {
        const target = pulso.getSnapshot().focusTarget;
        if (target) return document.getElementById(`habit-action-${target}`) || createTrigger;
        return createTrigger;
      }} onKeyDown={trapTab}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <DialogTitle className="text-2xl font-semibold">Añadir hábito</DialogTitle>
          <DialogDescription className="mt-2 text-base">Empieza con algo pequeño. Puedes editarlo después.</DialogDescription>
        </div>
        <button type="button" className="action-icon shrink-0" aria-label="Cerrar" disabled={protectedOperation} onClick={() => pulso.closeCreate()}>
          <X size={20} />
        </button>
      </div>
      <form noValidate onSubmit={event => {
        event.preventDefault();
        void pulso.create();
        setValidationAttempt(attempt => attempt + 1);
      }}>
        <ValidationSummary prefix="create" errors={errors} />
        <Fields prefix="create" raw={create.raw} errors={errors} nameRef={nameRef} stacked
          disabled={op?.status === "pending"} onChange={pulso.changeCreate} />
        {op && <div className="mt-4" role={op.status === "pending" ? "status" : "alert"}>
          {op.status === "pending" ? <p>Guardando</p> :
            op.status === "uncertain" ? <div className="notice space-y-3">
              <p className="font-semibold">No se pudo confirmar el resultado</p>
              <p>Recupera el envío anterior antes de crear otro hábito. Conservamos el nombre enviado: <span className="whitespace-pre-wrap break-words">{String(op.payload.nombre)}</span>.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="action-secondary" onClick={() => void pulso.retry("create")}>Reintentar</button>
                {create.revision !== op.revision && <button type="button" className="action-secondary" onClick={() => void pulso.retry("create")}>Recuperar envío anterior</button>}
              </div>
            </div> : <div className="notice space-y-3">
              <p>{op.error?.message || "No se pudo crear el hábito."}</p>
              <button type="button" className="action-secondary" onClick={() => pulso.clearRejected("create")}>Revisar los campos</button>
            </div>}
        </div>}
        {create.recovered && <div className="notice mt-4 space-y-3" role="status">
          <p className="font-semibold">Envío anterior recuperado</p>
          <p className="whitespace-pre-wrap break-words">El hábito «{create.recovered.nombre}» está guardado. Tu edición más reciente sigue en el formulario.</p>
          <p>Si quieres crear otro hábito con estos nuevos valores, prepara un envío nuevo.</p>
          <button type="button" className="action-secondary" onClick={() => pulso.prepareCreate()}>Preparar nuevos cambios</button>
        </div>}
        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-border pt-4">
          <button type="button" className="action-secondary" disabled={protectedOperation} onClick={() => pulso.closeCreate()}>Cancelar</button>
          <button type="submit" className="action-primary" disabled={!!op || !!create.recovered}>Crear hábito</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
