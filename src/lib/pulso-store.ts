"use client";

import { establishSession, SessionProblem } from "./pulso-session";
import {
  ApiError, Habit, RawDraft, Snapshot, draftFrom, editablePayload,
  emptyDraft, isValid, sameDraft,
} from "./pulso-types";

export type Edit = {
  raw: RawDraft; confirmed: Habit; revision: number; changedAt: number;
  open: boolean; dirty: boolean; hold: boolean;
};
export type Operation = {
  kind: "create" | "edit" | "mark" | "delete";
  path: string; method: string; payload: Readonly<Record<string, unknown>>;
  before?: Habit; revision?: number;
  status: "pending" | "uncertain" | "conflict" | "rejected";
  error?: ApiError;
};
type CreateState = {
  open: boolean; raw: RawDraft; revision: number; attempted: boolean;
  recovered?: { id: string; nombre: string };
};
export type PulsoState = {
  snapshot: Snapshot | null; loading: boolean; refreshing: boolean;
  error: string | null; sessionProblem: boolean;
  edits: Record<string, Edit>; operations: Record<string, Operation>;
  create: CreateState; focusTarget: string | null; announcement: string;
  pulses: Record<string, number>;
};
const initial: PulsoState = {
  snapshot: null, loading: true, refreshing: false, error: null, sessionProblem: false,
  edits: {}, operations: {}, create: { open: false, raw: emptyDraft(), revision: 0, attempted: false },
  focusTarget: null, announcement: "", pulses: {},
};
let state = initial;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let loadNumber = 0;
let contextGeneration = 0;
let initialized = false;
let route: "/" | "/semana" = "/";
function publish(patch: Partial<PulsoState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
function operation(id: string, value?: Operation) {
  const operations = { ...state.operations };
  if (value) operations[id] = value;
  else delete operations[id];
  publish({ operations });
}
function editState(id: string, value: Edit) {
  publish({ edits: { ...state.edits, [id]: value } });
}

async function readSnapshot(): Promise<Snapshot> {
  const response = await fetch(route === "/semana" ? "/api/semana" : "/api/habitos", {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401) {
    initialized = false;
    throw new SessionProblem("No encontramos la sesión anterior. Reintenta en el contexto original; no crearemos otra automáticamente.");
  }
  if (!response.ok) throw new Error("No se pudieron cargar tus hábitos. Reintenta.");
  return response.json();
}

function mergeSnapshot(incoming: Snapshot, acknowledged?: string) {
  // Retain unconfirmed rows during incidental reads; explicit operation recovery
  // alone is allowed to reconcile an uncertain submitted snapshot.
  let habits = incoming.habitos;
  let records = incoming.registros;
  const previous = state.snapshot;
  if (previous) {
    const protectedIds = new Set([
      ...Object.keys(state.operations).filter(id => state.operations[id].status !== "rejected"),
      ...Object.keys(state.edits).filter(id => state.edits[id].dirty),
    ].filter(id => id !== acknowledged && id !== "create"));
    habits = habits.filter(h => !protectedIds.has(h.id));
    habits.push(...previous.habitos.filter(h => protectedIds.has(h.id)));
    records = records.filter(r => !protectedIds.has(r.habito_id));
    records.push(...previous.registros.filter(r => protectedIds.has(r.habito_id) && incoming.context.days.includes(r.fecha)));
    // A concurrent list request cannot downgrade a more recently confirmed row.
    for (const previousHabit of previous.habitos) {
      const next = habits.find(h => h.id === previousHabit.id);
      if (next && next.version < previousHabit.version) {
        habits = habits.map(h => h.id === next.id ? previousHabit : h);
        records = records.filter(r => r.habito_id !== next.id).concat(
          previous.registros.filter(r => r.habito_id === next.id && incoming.context.days.includes(r.fecha)),
        );
      }
    }
  }
  habits.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const edits = { ...state.edits };
  for (const habit of habits) {
    const edit = edits[habit.id];
    if (edit && !edit.dirty && !state.operations[habit.id])
      edits[habit.id] = { ...edit, raw: draftFrom(habit), confirmed: habit };
  }
  publish({ snapshot: { ...incoming, habitos: habits, registros: records }, edits });
}

async function refresh(restart = false) {
  const sequence = ++loadNumber;
  if (restart) {
    ++contextGeneration;
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
    publish({ snapshot: null, edits: {}, operations: {}, create: { open: false, raw: emptyDraft(), revision: 0, attempted: false }, loading: true });
  }
  publish({ refreshing: true, error: null });
  try {
    if (!initialized || restart) {
      await establishSession(restart);
      initialized = true;
    }
    const incoming = await readSnapshot();
    if (sequence !== loadNumber) return;
    mergeSnapshot(incoming);
    publish({ loading: false, refreshing: false, sessionProblem: false });
  } catch (error) {
    if (sequence !== loadNumber) return;
    publish({
      loading: false, refreshing: false,
      error: error instanceof Error ? error.message : "No se pudo cargar. Reintenta.",
      sessionProblem: error instanceof SessionProblem,
    });
  }
}

function schedule(id: string) {
  clearTimeout(timers.get(id));
  const edit = state.edits[id];
  if (!edit?.dirty || edit.hold || !isValid(edit.raw) || state.operations[id]) return;
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    const current = state.edits[id];
    const habit = state.snapshot?.habitos.find(h => h.id === id);
    if (!current?.dirty || !habit || current.hold || !isValid(current.raw) || state.operations[id]) return;
    void send(id, {
      kind: "edit", method: "PATCH", path: `/api/habitos/${id}`, before: current.confirmed,
      revision: current.revision, status: "pending",
      payload: Object.freeze({ ...editablePayload(current.raw), version: current.confirmed.version, clave: crypto.randomUUID() }),
    });
  }, Math.max(0, 500 - (Date.now() - edit.changedAt))));
}

async function send(id: string, submitted: Operation): Promise<boolean> {
  if (state.operations[id]?.status === "pending") return false;
  const generation = contextGeneration;
  const previousOrder = state.snapshot?.habitos.map(habit => habit.id) ?? [];
  const nextHabitIds = previousOrder.slice(previousOrder.indexOf(id) + 1);
  clearTimeout(timers.get(id));
  const pending = { ...submitted, status: "pending" as const, error: undefined };
  operation(id, pending);
  try {
    const response = await fetch(pending.path, {
      method: pending.method, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.payload),
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json();
    if (generation !== contextGeneration) return false;
    if (!response.ok) {
      if (response.status >= 500) throw new Error("uncertain");
      const error: ApiError = body.error ?? { code: "REQUEST_FAILED", message: "No se pudo completar la solicitud." };
      operation(id, { ...pending, status: error.code === "VERSION_CONFLICT" ? "conflict" : "rejected", error });
      if (response.status === 401) {
        initialized = false;
        publish({ sessionProblem: true, error: "No encontramos la sesión anterior. Reintenta en el contexto original." });
      }
      return false;
    }
    if (!body.result?.id || !Number.isSafeInteger(body.result.version)) throw new Error("uncertain");
    // A full authorized read supplies real record IDs and the latest version,
    // including later writes when the acknowledgement is an old replay.
    const incoming = await readSnapshot();
    if (generation !== contextGeneration) return false;
    ++loadNumber; // Invalidate any earlier route/focus read.
    mergeSnapshot(incoming, id);
    const saved = incoming.habitos.find(h => h.id === body.result.id);
    const currentEdit = state.edits[id];
    if (currentEdit && saved) {
      const newerInput = pending.kind === "edit"
        ? currentEdit.revision !== pending.revision : currentEdit.dirty;
      const raw = newerInput ? currentEdit.raw : draftFrom(saved);
      editState(id, { ...currentEdit, raw, confirmed: saved, dirty: !sameDraft(raw, draftFrom(saved)) });
    }
    operation(id);
    const patch: Partial<PulsoState> = { refreshing: false, loading: false, error: null, sessionProblem: false };
    if (pending.kind === "create") {
      const newerInput = state.create.revision !== pending.revision;
      patch.create = newerInput
        ? { ...state.create, recovered: { id: body.result.id, nombre: String(pending.payload.nombre) } }
        : { open: false, raw: emptyDraft(), revision: 0, attempted: false };
      if (!newerInput) patch.focusTarget = body.result.id;
      patch.announcement = "Hábito creado. Guardado.";
    } else if (pending.kind === "delete") {
      const edits = { ...state.edits };
      delete edits[id];
      patch.edits = edits;
      patch.focusTarget = nextHabitIds.find(nextId => incoming.habitos.some(habit => habit.id === nextId)) ?? "add";
      patch.announcement = "Hábito eliminado.";
    } else if (pending.kind === "mark") {
      patch.pulses = { ...state.pulses, [`${id}:${pending.payload.fecha}`]: (state.pulses[`${id}:${pending.payload.fecha}`] ?? 0) + 1 };
      patch.announcement = pending.payload.completado ? "Marca guardada." : "Marca desmarcada. Guardado.";
    }
    publish(patch);
    schedule(id);
    return true;
  } catch {
    if (generation !== contextGeneration) return false;
    operation(id, { ...pending, status: "uncertain" });
    return false;
  }
}

export const pulso = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => initial,
  navigate(path: string) { route = path === "/semana" ? "/semana" : "/"; void refresh(); },
  refresh,
  openCreate() {
    publish({ create: { ...state.create, open: true }, focusTarget: null });
  },
  closeCreate() {
    const op = state.operations.create;
    if (op && ["pending", "uncertain"].includes(op.status)) return;
    operation("create");
    publish({
      create: { open: false, raw: emptyDraft(), revision: 0, attempted: false },
      ...(state.create.recovered ? { focusTarget: state.create.recovered.id } : {}),
    });
  },
  changeCreate(raw: RawDraft) {
    publish({ create: { ...state.create, raw, revision: state.create.revision + 1 } });
  },
  async create() {
    publish({ create: { ...state.create, attempted: true } });
    if (!isValid(state.create.raw) || state.operations.create || state.create.recovered) return false;
    return send("create", {
      kind: "create", path: "/api/habitos", method: "POST", revision: state.create.revision,
      status: "pending", payload: Object.freeze({ ...editablePayload(state.create.raw), clave: crypto.randomUUID() }),
    });
  },
  prepareCreate() {
    if (!state.create.recovered || state.operations.create) return;
    // An explicit separate intent is the only path to a second creation key.
    publish({ create: { ...state.create, recovered: undefined, attempted: false } });
  },
  openEdit(habit: Habit) {
    const existing = state.edits[habit.id];
    editState(habit.id, existing ? { ...existing, open: !existing.open } : {
      raw: draftFrom(habit), confirmed: habit, revision: 0, changedAt: 0, open: true, dirty: false, hold: false,
    });
  },
  changeEdit(id: string, raw: RawDraft) {
    const edit = state.edits[id];
    if (!edit) return;
    // Even returning to the old value is dirty when an earlier request may commit.
    const dirty = !!state.operations[id] || !sameDraft(raw, draftFrom(edit.confirmed));
    editState(id, { ...edit, raw, revision: edit.revision + 1, changedAt: Date.now(), dirty,
      hold: edit.hold || state.operations[id]?.status === "uncertain" });
    if (state.operations[id]?.status === "rejected") operation(id);
    schedule(id);
  },
  discard(id: string) {
    const habit = state.snapshot?.habitos.find(h => h.id === id);
    if (!habit || (state.operations[id] && state.operations[id].status !== "rejected")) return;
    operation(id);
    clearTimeout(timers.get(id));
    const edit = state.edits[id];
    if (edit) editState(id, { ...edit, raw: draftFrom(habit), confirmed: habit, dirty: false, hold: false });
  },
  pauseEdit(id: string) {
    if (state.operations[id]) return;
    clearTimeout(timers.get(id));
    const edit = state.edits[id];
    if (edit) editState(id, { ...edit, hold: true });
  },
  mark(habit: Habit, date: string, completed: boolean) {
    if (state.operations[habit.id] || state.edits[habit.id]?.dirty || state.sessionProblem || state.error) return;
    return send(habit.id, {
      kind: "mark", path: `/api/habitos/${habit.id}/registros`, method: "PUT", before: habit, status: "pending",
      payload: Object.freeze({ fecha: date, completado: completed, version: habit.version, clave: crypto.randomUUID() }),
    });
  },
  delete(habit: Habit) {
    if (state.operations[habit.id] || state.edits[habit.id]?.dirty) return Promise.resolve(false);
    return send(habit.id, {
      kind: "delete", path: `/api/habitos/${habit.id}`, method: "DELETE", before: habit, status: "pending",
      payload: Object.freeze({ version: habit.version, clave: crypto.randomUUID() }),
    });
  },
  retry(id: string) {
    const op = state.operations[id];
    if (!op || op.status === "pending") return Promise.resolve(false);
    return send(id, op);
  },
  async prepare(id: string) {
    const op = state.operations[id];
    if (op?.status === "uncertain" && !await send(id, op)) return;
    const edit = state.edits[id];
    if (edit) {
      editState(id, { ...edit, hold: false, changedAt: Date.now() });
      schedule(id);
    }
  },
  useCurrent(id: string) {
    const current = state.operations[id]?.error?.current;
    if (!current || !state.snapshot) return;
    const snapshot = state.snapshot;
    operation(id);
    mergeSnapshot({
      ...snapshot, habitos: snapshot.habitos.map(h => h.id === id ? current.habito : h),
      registros: snapshot.registros.filter(r => r.habito_id !== id).concat(current.registros),
    }, id);
    const edit = state.edits[id];
    if (edit) editState(id, { ...edit, raw: draftFrom(current.habito), confirmed: current.habito, dirty: false, hold: false });
  },
  overwrite(id: string) {
    const op = state.operations[id];
    const current = op?.error?.current;
    if (!current || !op) return;
    const edit = state.edits[id];
    if (op.kind === "edit" && (!edit || !isValid(edit.raw))) return;
    const fields = op.kind === "edit" && edit ? editablePayload(edit.raw) : op.payload;
    return send(id, { ...op, before: current.habito, revision: edit?.revision,
      payload: Object.freeze({ ...fields, version: current.habito.version, clave: crypto.randomUUID() }) });
  },
  clearRejected(id: string) {
    if (state.operations[id]?.status === "rejected") operation(id);
  },
  consumeFocus() { publish({ focusTarget: null }); },
  hasUnsaved() {
    return Object.values(state.edits).some(edit => edit.dirty) ||
      Object.values(state.operations).some(op => op.status !== "rejected") ||
      (state.create.open && Object.values(state.create.raw).some(Boolean));
  },
};
