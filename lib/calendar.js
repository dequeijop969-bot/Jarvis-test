// Google Agenda: leitura (hoje, amanhã, semana, próximo compromisso, conflitos, janelas livres). A única escrita é criar evento, em google.js, com confirmação.
// Usa o fuso do perfil, todas as agendas marcadas como visíveis (selected) e expande recorrentes (singleEvents).
// Títulos de eventos vêm de terceiros (convites): são DADOS, nunca instruções. Nada aqui passa por IA com ferramentas.
import { calendarGet } from './google.js';

let nowFn = () => Date.now();
export const _setNow = fn => { nowFn = fn || (() => Date.now()); clearCache(); };
export const now = () => nowFn();

export const WORK = { start: 8, end: 20, minFree: 30 }; // janela útil para "quando estou livre" (horas locais)

/* ---------- Fuso horário sem bibliotecas ---------- */
const validTz = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
export const zoneOf = p => (p?.city?.timezone && p.city.timezone !== 'auto' && validTz(p.city.timezone)) ? p.city.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
function parts(ms, tz) {
  const o = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)))
    if (x.type !== 'literal') o[x.type] = Number(x.value);
  return o;
}
const offset = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
// Instante (ms) de y-m-d h:mi no fuso tz.
export function zoned(y, m, d, h = 0, mi = 0, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offset(guess, tz);
  t = guess - offset(t, tz);
  return t;
}
export function dayStart(ms, tz, addDays = 0) {
  const p = parts(ms, tz), base = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, tz);
}
const dateKey = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
export const hhmm = (ms, tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const weekday = (ms, tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long' }).format(new Date(ms));
const spokenTime = (ms, tz) => { const p = parts(ms, tz); return p.minute ? `${p.hour}h${String(p.minute).padStart(2, '0')}` : `${p.hour}h`; };

/* ---------- Leitura ---------- */
const cache = new Map(); // 2 minutos
const clearCache = () => cache.clear();
export const _clearCalendarCache = clearCache;
const clipT = s => String(s || '(sem título)').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '(sem título)';
const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.toString() : null; } catch { return null; } };

async function calendars() {
  const j = await calendarGet(`/users/me/calendarList?${new URLSearchParams({ minAccessRole: 'reader', maxResults: '250' })}`);
  return (j.items || []).filter(c => c.selected === true || c.primary === true).map(c => ({ id: c.id, name: clipT(c.summaryOverride || c.summary), primary: !!c.primary }));
}

function normalize(e, cal, tz) {
  if (!e || e.status === 'cancelled') return null;
  const me = (e.attendees || []).find(a => a.self);
  if (me?.responseStatus === 'declined') return null;
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const start = allDay ? zoned(...e.start.date.split('-').map(Number), 0, 0, tz) : Date.parse(e.start?.dateTime);
  const end = allDay ? zoned(...(e.end?.date || e.start.date).split('-').map(Number), 0, 0, tz) : Date.parse(e.end?.dateTime || e.start?.dateTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const video = (e.conferenceData?.entryPoints || []).find(x => x.entryPointType === 'video')?.uri;
  return {
    id: String(e.id || '').slice(0, 120), title: clipT(e.summary), calendar: cal.name, start, end, allDay,
    busy: e.transparency !== 'transparent' && !allDay, recurring: !!e.recurringEventId,
    meet: safeUrl(e.hangoutLink || video || ''), link: safeUrl(e.htmlLink || '')
  };
}

// Eventos entre [from, to) em todas as agendas visíveis, ordenados.
export async function events(from, to, tz) {
  const k = `${from}|${to}|${tz}`, hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  const cals = await calendars();
  const all = [];
  await Promise.all(cals.map(async cal => {
    const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: tz });
    try {
      const j = await calendarGet(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      for (const e of j.items || []) { const n = normalize(e, cal, tz); if (n && n.end > from && n.start < to) all.push(n); }
    } catch (e) { if (cal.primary) throw e; /* agenda secundária indisponível: segue sem ela */ }
  }));
  // Mesmo evento em duas agendas (convite compartilhado): mantém um.
  const seen = new Set(), out = [];
  for (const e of all.sort((a, b) => (b.allDay - a.allDay) || a.start - b.start || a.end - b.end)) {
    const key = `${e.title}|${e.start}|${e.end}`;
    if (!seen.has(key)) { seen.add(key); out.push(e); }
  }
  cache.set(k, { v: out, exp: Date.now() + 120_000 });
  return out;
}

export function conflicts(list) {
  const timed = list.filter(e => e.busy).sort((a, b) => a.start - b.start), out = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++) out.push([timed[i].id, timed[j].id]);
  return out;
}

// Janelas livres dentro do horário útil do dia (a partir de agora, se for hoje).
export function freeWindows(list, dayMs, tz, t = now()) {
  const p = parts(dayMs, tz);
  let a = zoned(p.year, p.month, p.day, WORK.start, 0, tz);
  const b = zoned(p.year, p.month, p.day, WORK.end, 0, tz);
  if (t > a) a = Math.ceil(t / 300_000) * 300_000; // arredonda para 5 min
  const busy = list.filter(e => e.busy && e.end > a && e.start < b).map(e => [Math.max(a, e.start), Math.min(b, e.end)]).sort((x, y) => x[0] - y[0]);
  const out = []; let cur = a;
  for (const [s, e] of busy) { if (s - cur >= WORK.minFree * 60_000) out.push({ start: cur, end: s }); cur = Math.max(cur, e); }
  if (b - cur >= WORK.minFree * 60_000) out.push({ start: cur, end: b });
  return out;
}

const RANGES = { today: [0, 1], tomorrow: [1, 2], week: [0, 7] };
export async function agenda(range = 'today', profile) {
  const tz = zoneOf(profile), t = now(), [d0, d1] = RANGES[range] || RANGES.today;
  const from = dayStart(t, tz, d0), to = dayStart(t, tz, d1);
  const list = await events(from, to, tz);
  // Próximo compromisso: o primeiro com horário que ainda não começou (busca até 7 dias).
  const ahead = range === 'week' ? list : await events(dayStart(t, tz, 0), dayStart(t, tz, 7), tz);
  const next = ahead.find(e => !e.allDay && e.start > t) || null;
  const current = ahead.filter(e => !e.allDay && e.start <= t && e.end > t);
  const dayMs = range === 'tomorrow' ? from : dayStart(t, tz, 0);
  const free = range === 'week' ? [] : freeWindows(list.filter(e => e.start < dayStart(dayMs, tz, 1)), dayMs, tz, t);
  const fmt = e => ({ ...e, startLabel: e.allDay ? 'dia todo' : hhmm(e.start, tz), endLabel: e.allDay ? '' : hhmm(e.end, tz), day: dateKey(e.start, tz), weekday: weekday(e.start, tz) });
  return {
    range, tz, now: t, from, to, events: list.map(fmt), next: next ? fmt(next) : null, current: current.map(fmt),
    conflicts: conflicts(list), free: free.map(w => ({ ...w, startLabel: hhmm(w.start, tz), endLabel: hhmm(w.end, tz) })),
    today: dateKey(t, tz)
  };
}

/* ---------- Fala (modelos fixos, sem IA) ---------- */
const plural = (n, s, p) => `${n === 1 ? 'um' : n} ${n === 1 ? s : p}`;
const lastJoin = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} e ${a.at(-1)}`;
export function agendaSpeech(a, kind = 'day', addr = { Subject: 'O senhor', short: 'senhor' }) {
  const tz = a.tz, timed = a.events.filter(e => !e.allDay), allDay = a.events.filter(e => e.allDay);
  const when = a.range === 'tomorrow' ? 'amanhã' : a.range === 'week' ? 'nos próximos sete dias' : 'hoje';
  if (kind === 'next') {
    if (!a.next) return `${addr.Subject} não tem mais compromissos nos próximos sete dias.`;
    const mins = Math.round((a.next.start - a.now) / 60_000), sameDay = a.next.day === a.today;
    const rel = mins < 60 ? `daqui a ${mins} ${mins === 1 ? 'minuto' : 'minutos'}` : sameDay ? `às ${spokenTime(a.next.start, tz)}` : `${a.next.weekday}, às ${spokenTime(a.next.start, tz)}`;
    return `Seu próximo compromisso é ${a.next.title}, ${rel}.${a.next.meet ? ' Tem link de reunião no painel.' : ''}`;
  }
  if (kind === 'free') {
    if (!a.free.length) return `${when === 'hoje' ? 'Hoje' : 'Amanhã'} não sobra nenhuma janela livre de meia hora entre ${WORK.start}h e ${WORK.end}h.`;
    const w = a.free.slice(0, 4).map(f => `das ${spokenTime(f.start, tz)} às ${spokenTime(f.end, tz)}`);
    return `${addr.Subject} está livre ${when} ${lastJoin(w)}.`;
  }
  if (!a.events.length) return `${when === 'hoje' ? 'Agenda livre hoje' : when === 'amanhã' ? 'Nada marcado para amanhã' : 'Nada marcado nos próximos sete dias'}, ${addr.short}.`;
  if (a.range === 'week') {
    const days = [...new Set(timed.map(e => e.day))].length;
    return `${addr.Subject} tem ${plural(timed.length, 'compromisso', 'compromissos')} ${when}, espalhados em ${plural(days, 'dia', 'dias')}.${a.conflicts.length ? ` Atenção: ${plural(a.conflicts.length, 'conflito', 'conflitos')} de horário.` : ''}`;
  }
  const bits = [];
  if (timed.length) {
    const first = timed.find(e => e.end > a.now) || timed[0];
    bits.push(`${addr.Subject} tem ${plural(timed.length, 'compromisso', 'compromissos')} ${when}.`);
    const pre = first.start <= a.now ? 'Agora está rolando' : timed.length > 1 && first === timed[0] ? 'O primeiro é' : timed.length > 1 ? 'O próximo é' : 'É';
    bits.push(`${pre} ${first.title}, ${first.start <= a.now ? 'até' : 'às'} ${spokenTime(first.start <= a.now ? first.end : first.start, tz)}.`);
  } else bits.push(`${when === 'hoje' ? 'Hoje' : 'Amanhã'} não há compromissos com horário.`);
  if (allDay.length) bits.push(`O dia todo: ${lastJoin(allDay.slice(0, 2).map(e => e.title))}.`);
  if (a.conflicts.length) bits.push(`E cuidado: ${plural(a.conflicts.length, 'conflito', 'conflitos')} de horário.`);
  return bits.join(' ');
}
// Resumo curto para a memória (só título e horário, 7 dias).
export const memoryItems = a => a.events.slice(0, 20).map(e => ({ title: e.title, when: `${e.day} ${e.startLabel}` }));

// "hoje às 15h", "amanhã às 9h30", "quinta-feira, 9 de outubro, às 15h" (modelo fixo, sem IA).
export function whenSpeech(startMs, tz, t = now()) {
  const dk = dateKey(startMs, tz), today = dateKey(t, tz), tomorrow = dateKey(dayStart(t, tz, 1), tz);
  const day = dk === today ? 'hoje' : dk === tomorrow ? 'amanhã'
    : `${weekday(startMs, tz)}, ${new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: 'numeric', month: 'long' }).format(new Date(startMs))}`;
  return `${day}, às ${spokenTime(startMs, tz)}`;
}
export const durationSpeech = ms => { const m = Math.round(ms / 60_000); if (m % 60 === 0) return m === 60 ? 'uma hora' : `${m / 60} horas`; return m < 60 ? `${m} minutos` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
export const weekdayName = (ms, tz) => weekday(ms, tz);
export const todayKey = (ms, tz) => dateKey(ms, tz);
