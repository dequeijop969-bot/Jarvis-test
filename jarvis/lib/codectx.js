// Contexto do modo Code, salvo em data/code-context.json (sobrevive a reinícios do servidor).
// Guarda o que o Jarvis FEZ no PC: apps abertos (e em qual monitor), as últimas tarefas com os passos e onde pararam.
// Vai para o planejador do modo Code e para cada passo das tarefas, para "abre a biblioteca e escolhe um jogo"
// saber que a Steam já está aberta, e "continua"/"tenta de novo" saber de onde retomar. Tudo aqui é DADO, nunca instrução.
import { readJSON, writeJSON } from './store.js';

const FILE = 'code-context.json';
const EMPTY = { apps: {}, tasks: [] };
const TTL = 6 * 3600_000;          // depois de 6 h, o que está na tela já mudou: esquece
const KEEP_TASKS = 10;
const clip = (s, n) => String(s ?? '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

let ctx = null;
const load = () => (ctx ??= { ...structuredClone(EMPTY), ...readJSON(FILE, EMPTY) });
const save = () => writeJSON(FILE, ctx);
function purge() {
  const c = load(), now = Date.now();
  for (const [k, v] of Object.entries(c.apps)) if (now - v.at > TTL) delete c.apps[k];
  c.tasks = c.tasks.filter(t => now - t.at < TTL).slice(-KEEP_TASKS);
  return c;
}

// Um app/site foi aberto (ou trazido para a frente) pelo Jarvis.
export function noteOpen(label, monitor = null) {
  const c = purge(), k = clip(label, 60).toLowerCase();
  if (!k) return;
  c.apps[k] = { label: clip(label, 60), monitor: [1, 2, 3].includes(+monitor) ? +monitor : (c.apps[k]?.monitor ?? null), at: Date.now() };
  save();
}

// Uma ação do modo Code terminou (tarefa de vários passos, clique, escrever, Steam...).
export function noteTask({ request, goal = '', kind = 'tarefa', status = 'ok', say = '', steps = [], monitor = null }) {
  const c = purge();
  c.tasks.push({ at: Date.now(), kind: clip(kind, 20), request: clip(request, 300), goal: clip(goal, 300), status: clip(status, 20), say: clip(say, 300),
    monitor: [1, 2, 3].includes(+monitor) ? +monitor : null,
    steps: steps.slice(-12).map(s => clip(`${s.acao}${s.alvo ? ` "${s.alvo}"` : ''}${s.ok === false ? ' (falhou)' : ''}`, 100)) });
  c.tasks = c.tasks.slice(-KEEP_TASKS);
  save();
}

// A última tarefa que não terminou bem (para "continua", "tenta de novo").
export function unfinished() {
  const t = purge().tasks.filter(x => x.kind === 'tarefa').at(-1);
  return t && t.status !== 'ok' && Date.now() - t.at < 30 * 60_000 ? structuredClone(t) : null;
}

const ago = ms => ms < 90_000 ? 'agora há pouco' : ms < 3600_000 ? `há ${Math.round(ms / 60_000)} min` : `há ${Math.round(ms / 3600_000)} h`;
const STATUS = { ok: 'concluída', desistiu: 'desistiu', cancelado: 'cancelada pelo usuário', limite: 'parou no limite de passos', tempo: 'parou por tempo', preso: 'travou repetindo', erro: 'deu erro' };

// Texto curto para os prompts (vazio se não houver nada recente).
export function summary(maxTasks = 5) {
  const c = purge(), now = Date.now(), lines = [];
  const apps = Object.values(c.apps).sort((a, b) => b.at - a.at).slice(0, 6);
  if (apps.length) lines.push('Apps/sites que o Jarvis abriu: ' + apps.map(a => `${a.label}${a.monitor ? ` (monitor ${a.monitor})` : ''}, ${ago(now - a.at)}`).join('; ') + '.');
  for (const t of c.tasks.slice(-maxTasks)) {
    lines.push(`- ${ago(now - t.at)}: pedido "${t.request}"${t.monitor ? ` [monitor ${t.monitor}]` : ''} → ${t.kind}, ${STATUS[t.status] || t.status}` +
      (t.steps.length ? `. Passos: ${t.steps.join(' → ')}` : '') + (t.say ? `. Jarvis disse: "${t.say}"` : ''));
  }
  return lines.join('\n');
}

export function clear() { ctx = structuredClone(EMPTY); save(); }
export const _reset = () => { ctx = null; };
