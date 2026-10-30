// Memória local em data/memory.json: turnos recentes, resumo contínuo, preferências e resumos curtos (7 dias)
// de e-mails, agenda (só título e horário) e GitHub (só repositório, número e título).
// Tudo aqui é DADO para o modelo, nunca instrução.
import crypto from 'node:crypto';
import { readJSON, writeJSON } from './store.js';

const FILE = 'memory.json';
const EMPTY = { turns: [], summary: '', prefs: [], emails: [], agenda: [], github: [] };
const EMAIL_TTL = 7 * 24 * 3600_000;
export const KEEP_TURNS = 8;         // turnos (mensagens) enviados ao modelo
export const COMPACT_AT = 20;        // acima disso, resume os antigos

let mem = null;
const load = () => (mem ??= { ...structuredClone(EMPTY), ...readJSON(FILE, EMPTY) });
const save = () => writeJSON(FILE, mem);
const id = () => crypto.randomBytes(6).toString('hex');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function purge() {
  const m = load(), now = Date.now();
  let changed = false;
  for (const k of ['emails', 'agenda', 'github']) {
    m[k] ||= [];
    const before = m[k].length;
    m[k] = m[k].filter(e => now - Date.parse(e.at) < EMAIL_TTL);
    if (before !== m[k].length) changed = true;
  }
  return changed;
}

export function context() {
  if (purge()) save();
  const m = load();
  return {
    summary: m.summary, prefs: m.prefs.map(p => p.text),
    messages: m.turns.slice(-KEEP_TURNS).map(t => ({ role: t.role, content: t.content })),
    emails: m.emails.slice(-12).map(e => ({ from: e.from, subject: e.subject, summary: e.summary })),
    agenda: m.agenda.slice(-10).map(e => `${e.when}: ${e.title}`),
    github: m.github.slice(-10).map(e => e.text)
  };
}

export function addExchange(userText, assistantText, learned = []) {
  const m = load(), tid = id(), at = new Date().toISOString();
  m.turns.push({ id: tid, role: 'user', content: clip(userText, 1200), at }, { id: tid, role: 'assistant', content: clip(assistantText, 1500), at });
  for (const t of learned.slice(0, 2)) {
    const text = clip(t, 140);
    if (text && !m.prefs.some(p => p.text.toLowerCase() === text.toLowerCase())) m.prefs.push({ id: id(), text, turnId: tid, at });
  }
  m.prefs = m.prefs.slice(-30);
  save();
  return m.turns.length > COMPACT_AT;
}

// Resume os turnos antigos com a IA (summarize recebe o texto e devolve o novo resumo).
export async function compact(summarize) {
  const m = load();
  if (m.turns.length <= COMPACT_AT) return false;
  const old = m.turns.slice(0, -KEEP_TURNS);
  try {
    const s = await summarize(m.summary, old.map(t => `${t.role === 'user' ? 'Usuário' : 'Assistente'}: ${t.content}`).join('\n'));
    if (s) m.summary = clip(s, 1200);
    m.turns = m.turns.slice(-KEEP_TURNS);
  } catch { m.turns = m.turns.slice(-40); }
  save();
  return true;
}

export function rememberEmails(list) {
  const m = load(), at = new Date().toISOString();
  for (const e of list) {
    if (m.emails.some(x => x.gid === e.id)) continue;
    m.emails.push({ gid: e.id, from: clip(e.from_name || e.from_domain, 60), subject: clip(e.subject, 120), summary: clip(e.summary, 140), at });
  }
  purge();
  m.emails = m.emails.slice(-100);
  save();
}

// Agenda: só título curto e horário. GitHub: só "repo#n título" curto. Substitui o que havia (é um retrato).
export function rememberAgenda(items) {
  const m = load(), at = new Date().toISOString();
  m.agenda = items.slice(0, 20).map(e => ({ title: clip(e.title, 60), when: clip(e.when, 40), at }));
  save();
}
export function rememberGithub(lines) {
  const m = load(), at = new Date().toISOString();
  m.github = lines.slice(0, 20).map(t => ({ text: clip(t, 120), at }));
  save();
}
// E-mails que foram para a lixeira saem da memória.
export function forgetEmails(ids) {
  const m = load(), set = new Set(ids);
  const before = m.emails.length;
  m.emails = m.emails.filter(e => !set.has(e.gid));
  if (before !== m.emails.length) save();
}

export function forgetLast() {
  const m = load();
  const last = m.turns.at(-1);
  if (!last) return false;
  m.turns = m.turns.filter(t => t.id !== last.id);
  m.prefs = m.prefs.filter(p => p.turnId !== last.id);
  save();
  return true;
}
export function forgetAll() { mem = structuredClone(EMPTY); save(); }
export const snapshot = () => structuredClone(load());
export const _reset = () => { mem = null; };
