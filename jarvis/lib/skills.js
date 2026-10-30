// Skills: rotinas que você monta (Ajustes > Skills). Uma frase dispara vários passos em sequência, cada passo é um pedido
// normal ao Jarvis ("abre o VS Code", "toca lo-fi no Spotify", "o que tenho hoje na agenda", "cria um PDF com..."),
// executado do mesmo jeito que se você tivesse falado. Ficam em data/skills.json (no seu PC).
// Segurança: um passo não dispara outra skill (sem laço), no máximo 10 passos, e o que precisa de confirmação continua pedindo.
import { randomBytes } from 'node:crypto';
import { readJSON, writeJSON } from './store.js';

const FILE = 'skills.json';
export const LIMITS = { skills: 40, steps: 10, step: 240, triggers: 4 };
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Sugestões prontas (aparecem na aba para adicionar com um toque).
export const TEMPLATES = [
  { name: 'Modo trabalho', triggers: ['modo trabalho', 'hora de trabalhar'], steps: ['abre o VS Code', 'toca lo-fi para concentrar no Spotify', 'o que eu tenho hoje na agenda'] },
  { name: 'Bom dia', triggers: ['bom dia jarvis', 'começar o dia'], steps: ['como está o tempo hoje', 'o que eu tenho hoje na agenda', 'tenho e-mails importantes'] },
  { name: 'Fim do expediente', triggers: ['fim do expediente', 'encerrar o dia'], steps: ['o que eu tenho amanhã na agenda', 'cria um PDF com um resumo do que conversamos hoje e me manda'] },
  { name: 'Pausa', triggers: ['hora da pausa', 'modo pausa'], steps: ['toca uma música relaxante no Spotify', 'marca voltar ao trabalho daqui a 15 minutos'] }
];

let db = null;
const load = () => (db ??= readJSON(FILE, { skills: [] }));
const save = () => writeJSON(FILE, db);

export function clean(s) {
  const name = str(s?.name, 40);
  if (!name) throw Object.assign(new Error('Dê um nome à skill.'), { code: 400 });
  // Só textos: um objeto em "steps" virava o passo "[object Object]" (que ia para a IA como pedido).
  const texts = (v, sep) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : []).filter(x => typeof x === 'string');
  const triggers = texts(s?.triggers, /[,;\n]/).map(x => str(x, 60)).filter(x => fold(x).length >= 3).slice(0, LIMITS.triggers);
  const steps = texts(s?.steps, '\n').map(x => str(x, LIMITS.step)).filter(Boolean).slice(0, LIMITS.steps);
  if (!steps.length) throw Object.assign(new Error('Coloque pelo menos um passo.'), { code: 400 });
  return { name, triggers: triggers.length ? triggers : [name], steps, on: s?.on !== false };
}
export const list = () => load().skills;
export function upsert(s) {
  const d = load(), c = clean(s), i = s?.id ? d.skills.findIndex(x => x.id === String(s.id)) : -1;
  if (i >= 0) d.skills[i] = { ...d.skills[i], ...c };
  else { if (d.skills.length >= LIMITS.skills) throw Object.assign(new Error('Limite de skills atingido.'), { code: 429 }); d.skills.push({ id: randomBytes(6).toString('hex'), ...c, at: Date.now() }); }
  save();
  return i >= 0 ? d.skills[i] : d.skills.at(-1);
}
export function remove(id) { const d = load(), i = d.skills.findIndex(x => x.id === String(id)); if (i < 0) return false; d.skills.splice(i, 1); save(); return true; }
export const _reset = () => { db = null; };

// A frase dispara qual skill? Exata, ou "executa/roda/ativa a skill X", ou começando pelo gatilho ("modo trabalho, por favor").
export function match(text) {
  const t = fold(text).replace(/^(jarvis|ei|pode|por favor)\s+/, '').replace(/\s+(por favor|ai|agora|jarvis)$/, '');
  if (t.length < 3) return null;
  const run = t.match(/^(?:executa|execute|roda|rode|ativa|ative|inicia|inicie|faz|faca|liga|ligue)\s+(?:a\s+)?(?:skill|rotina|modo)\s+(.+)$/);
  for (const s of list()) {
    if (s.on === false) continue;
    const keys = [s.name, ...s.triggers].map(fold).filter(Boolean);
    if (keys.some(k => t === k || (run && (run[1] === k || `modo ${run[1]}` === k)) || (k.split(' ').length >= 2 && t.startsWith(k + ' ')))) return s;
  }
  return null;
}
