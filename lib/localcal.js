// Agenda do Jarvis (local): compromissos guardados no próprio PC, em data/agenda.json (fora do git).
// Não depende do Google: o Jarvis lê, marca e lembra daqui. Se o Google estiver conectado, as duas se somam na leitura.
import { randomBytes } from 'node:crypto';
import { readJSON, writeJSON } from './store.js';

const FILE = 'agenda.json';
export const LIMITS = { events: 2000, title: 120, notes: 400, where: 120 };
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
let db = null;
const load = () => (db ??= readJSON(FILE, { events: [] }));
const save = () => writeJSON(FILE, db);
const listeners = new Set();
export const onChange = f => listeners.add(f);
const changed = () => { for (const f of listeners) try { f(); } catch { /* cache de quem lê */ } };

export function clean(e) {
  const title = str(e?.title, LIMITS.title), start = Number(e?.start), end = Number(e?.end ?? e?.start);
  if (!title) throw Object.assign(new Error('Dê um nome ao compromisso.'), { code: 400 });
  if (!Number.isFinite(start) || start < Date.UTC(2000, 0, 1) || start > Date.UTC(2100, 0, 1)) throw Object.assign(new Error('Data inválida.'), { code: 400 });
  const allDay = e?.allDay === true;
  let fim = Number.isFinite(end) && end > start ? end : start + (allDay ? 86_400_000 : 3_600_000);
  if (fim - start > 31 * 86_400_000) fim = start + 31 * 86_400_000;
  return { title, start, end: fim, allDay, notes: str(e?.notes, LIMITS.notes), where: str(e?.where, LIMITS.where) };
}

export function add(e) {
  const d = load(), ev = { id: randomBytes(6).toString('hex'), ...clean(e), at: Date.now() };
  d.events.push(ev);
  d.events.sort((a, b) => a.start - b.start);
  if (d.events.length > LIMITS.events) d.events.splice(0, d.events.length - LIMITS.events);   // os mais antigos saem
  save(); changed();
  return ev;
}
export function remove(id) {
  const d = load(), i = d.events.findIndex(x => x.id === String(id));
  if (i < 0) return false;
  d.events.splice(i, 1); save(); changed();
  return true;
}
// Compromissos que tocam [from, to).
export const between = (from, to) => load().events.filter(e => e.end > from && e.start < to);
export const upcoming = (from, days = 60) => between(from, from + days * 86_400_000);
export const _reset = () => { db = null; };

// No formato da agenda do Google (calendar.js), para as duas se somarem.
export const asCalendar = e => ({ id: `loc_${e.id}`, title: e.title, calendar: 'Agenda do Jarvis', start: e.start, end: e.end, allDay: e.allDay,
  busy: !e.allDay, recurring: false, meet: null, link: null, local: true, notes: e.notes || '', where: e.where || '' });
