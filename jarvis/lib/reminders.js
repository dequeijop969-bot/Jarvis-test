// Lembretes, alarmes e timers ("me lembra de tomar remédio às 22h", "timer de 15 minutos", "alarme às 7").
// Guardados em data/lembretes.json (sobrevivem a reiniciar o Jarvis). O servidor confere a cada poucos segundos e,
// na hora, avisa o app (que fala o lembrete) e o Jarvis Code. Entende horários falados sem precisar da IA.
import crypto from 'node:crypto';
import { readJSON, writeJSON } from './store.js';

const FILE = 'lembretes.json';
const MAX = 60;
const load = () => readJSON(FILE, []).filter(x => x && Number.isFinite(x.at) && typeof x.text === 'string');
const save = l => writeJSON(FILE, l.slice(0, MAX));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s:]/g, ' ').replace(/\s+/g, ' ').trim();

// Números por extenso que aparecem em pedidos de tempo.
const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90 };
function words2num(t) {
  return t.replace(/\b(vinte|trinta|quarenta|cinquenta) e (um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\b/g, (_, a, b) => String(NUM[a] + NUM[b]))
    .replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|noventa)\b(?= (segundos?|minutos?|min|horas?|h\b|e meia|da manha|da tarde|da noite|horas))/g, w => String(NUM[w]))
    .replace(/\bmeia hora\b/g, '30 minutos').replace(/\buma hora e meia\b/g, '90 minutos').replace(/\b(\d+) horas? e meia\b/g, (_, h) => `${h * 60 + 30} minutos`);
}
const UNIT = u => /^seg/.test(u) ? 1000 : /^(h|hora)/.test(u) ? 3600_000 : 60_000;

// "às 22h", "as 7 e meia", "às 14:30", "8 da manhã", "amanhã às 9" → horário absoluto (sempre no futuro).
function clockAt(t, now, alarm = false) {
  const m = t.match(/\b(?:as|pras?|para as|ao|a) (\d{1,2})(?:(?::|h| e |h e )(\d{2}|meia))?\s*(?:h|horas?)?\b(?: (da manha|da tarde|da noite|de madrugada))?/)
    || t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)\b(?: (da manha|da tarde|da noite|de madrugada))?/)
    || t.match(/\b(\d{1,2}) (da manha|da tarde|da noite|de madrugada)\b/);
  if (!m) return null;
  let h = Number(m[1]), min = 0, per = m[3] || '';
  if (m[2] && /^\d+$/.test(m[2])) min = Number(m[2]); else if (m[2] === 'meia') min = 30; else if (/manha|tarde|noite|madrugada/.test(m[2] || '')) per = m[2];
  if (h > 23 || min > 59) return null;
  if (/tarde|noite/.test(per) && h < 12) h += 12;
  const d = new Date(now); d.setSeconds(0, 0); d.setHours(h, min);
  if (/\bamanha\b/.test(t)) d.setDate(d.getDate() + 1);
  else if (d.getTime() <= now) {
    // "às 7" já passou: se cabe à tarde/noite (sem período dito e hora até 11), 12h depois; senão, amanhã
    if (!alarm && !per && h < 12 && d.getTime() + 12 * 3600_000 > now) d.setHours(h + 12);
    else d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

// Entende o pedido. Devolve { op:'criar', kind, text, at } | { op:'listar' } | { op:'cancelar', what } | null.
export function parse(text, now = Date.now()) {
  let t = words2num(fold(text)).replace(/^(jarvis|ei|por favor) /, '');
  if (/\b(quais|quantos|tem algum|lista|mostra|meus)\b.*\b(lembretes?|alarmes?|timers?)\b/.test(t)) return { op: 'listar' };
  const cx = t.match(/\b(cancela|cancelar|apaga|apagar|remove|remover|tira|desliga|desligar)( o| os| a| as| meu| meus| todos os)? (lembretes?|alarmes?|timers?|temporizador)( de| do| da| pra| para| das?)?\s*(.*)$/);
  if (cx) return { op: 'cancelar', what: cx[5] || '', all: /\btodos\b/.test(t) || /s$/.test(cx[3]) };
  // timer / temporizador
  const tm = t.match(/\b(timer|temporizador|cronometro|contagem)\b.*?\b(\d+)\s*(segundos?|seg|minutos?|min|horas?|h)\b/) || t.match(/\b(\d+)\s*(segundos?|minutos?|min|horas?)\s+(de )?(timer|temporizador)\b/);
  if (tm) {
    const n = Number(tm[2] ?? tm[1]), u = tm[3] ?? tm[2];
    if (n > 0 && n <= 24 * 60) return { op: 'criar', kind: 'timer', text: `Timer de ${n} ${/^seg/.test(u) ? 'segundos' : /^h/.test(u) ? (n > 1 ? 'horas' : 'hora') : 'minutos'}`, at: now + n * UNIT(u) };
  }
  // alarme / me acorda
  if (/\b(alarme|despertador|me acorda|me acorde|desperta)\b/.test(t)) {
    const at = clockAt(t, now, true) ?? relAt(t, now);
    return at ? { op: 'criar', kind: 'alarme', text: 'Alarme', at } : { op: 'faltou_hora', kind: 'alarme' };
  }
  // lembrete: "me lembra/lembre/avisa (de/que/pra) X às/daqui a ..."
  const lm = t.match(/\b(?:me |nos )?(?:lembr[ae]|lembrar|avis[ae]|avisar|cria um lembrete|lembrete)\b(?: de| que| pra| para| do| da)?\s*(.*)$/);
  if (!lm) return null;
  const at = relAt(t, now) ?? clockAt(t, now);
  const what = restore(cleanWhat(lm[1]), text);
  // "lembra que eu odeio café" (sem horário e sem "me"/"lembrete") é para a memória, não um lembrete
  if (!at) return what && /\b(me|nos) (lembr|avis)|\blembrete\b/.test(t) ? { op: 'faltou_hora', kind: 'lembrete', text: what } : null;
  return { op: 'criar', kind: 'lembrete', text: what || 'Lembrete', at };
}
function relAt(t, now) {
  const m = t.match(/\b(?:daqui a|daqui|em|dentro de|depois de|apos) (\d+)\s*(segundos?|seg|minutos?|min|horas?|h)\b/);
  return m ? now + Number(m[1]) * UNIT(m[2]) : null;
}
// O que lembrar, sem o horário: "tomar o remédio às 22h" → "tomar o remédio"
function cleanWhat(s) {
  return String(s || '')
    .replace(/\b(daqui a|daqui|em|dentro de|depois de|apos) \d+\s*(segundos?|seg|minutos?|min|horas?|h)\b/g, '')
    .replace(/\b(hoje|amanha)\b/g, '').replace(/\b(as|pras?|para as) \d{1,2}(?:(?::|h| e |h e )(?:\d{2}|meia))?(?:\s*(?:h|horas?)\b)?(?: (?:da manha|da tarde|da noite|de madrugada))?/g, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(h|horas)\b( da manha| da tarde| da noite)?/g, '').replace(/\s+/g, ' ').trim().replace(/^(de|que|pra|para) /, '').slice(0, 120);
}

// Devolve o trecho com os acentos e maiúsculas do pedido original ("tomar o remedio" → "tomar o remédio").
function restore(foldedWhat, original) {
  if (!foldedWhat) return '';
  const want = foldedWhat.split(' '), orig = String(original).replace(/[^\p{L}\p{N}\s:-]/gu, ' ').split(/\s+/).filter(Boolean);
  const f = orig.map(w => fold(w));
  for (let i = 0; i + want.length <= orig.length; i++) if (want.every((w, k) => f[i + k] === w)) return orig.slice(i, i + want.length).join(' ');
  return foldedWhat;
}
export function add({ kind, text, at }) {
  const l = load(), item = { id: crypto.randomBytes(5).toString('hex'), kind, text: String(text).slice(0, 120), at, created: Date.now() };
  l.push(item); l.sort((a, b) => a.at - b.at); save(l); return item;
}
export const list = () => load().sort((a, b) => a.at - b.at);
export function cancel(what, all) {
  const l = load(), w = fold(what);
  const hit = all && !w ? l : l.filter(x => w ? fold(x.text).includes(w) || (w.includes('alarme') && x.kind === 'alarme') || (w.includes('timer') && x.kind === 'timer') : true).slice(0, all ? 99 : 1);
  if (!hit.length) return [];
  save(l.filter(x => !hit.includes(x))); return hit;
}
// Os que venceram (saem da lista).
export function due(now = Date.now()) {
  const l = load(), d = l.filter(x => x.at <= now);
  if (d.length) save(l.filter(x => x.at > now));
  return d;
}
export function when(at, now = Date.now()) {
  const d = new Date(at), mins = Math.round((at - now) / 60000), hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (mins < 1) return `em ${Math.max(1, Math.round((at - now) / 1000))} segundos`;
  if (mins < 60) return `daqui a ${mins} minuto${mins > 1 ? 's' : ''} (às ${hm})`;
  const same = new Date(now).toDateString() === d.toDateString(), tom = new Date(now + 86400_000).toDateString() === d.toDateString();
  return `${same ? 'hoje' : tom ? 'amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric' })} às ${hm}`;
}
