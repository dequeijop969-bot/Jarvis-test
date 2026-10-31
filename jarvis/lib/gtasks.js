// Google Tasks (mesmo login do Gmail): ver tarefas pendentes, adicionar ("põe leite na lista de compras") e concluir.
import { gfetch, canTasks } from './google.js';

const API = 'https://tasks.googleapis.com/tasks/v1';
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const need = () => { if (!canTasks()) throw Object.assign(new Error('Falta a permissão do Tasks. Reconecte o Google em Ajustes marcando todas as caixas.'), { code: 403 }); };

export async function lists() { need(); return ((await gfetch(`${API}/users/@me/lists?maxResults=50`))?.items || []).map(l => ({ id: l.id, title: l.title })); }
// A lista citada pelo nome ("compras", "trabalho"); sem nome, a primeira (a padrão do Google).
export async function pickList(name) {
  const all = await lists();
  if (!all.length) throw Object.assign(new Error('Nenhuma lista no Google Tasks.'), { code: 404 });
  if (name) { const w = fold(name); const hit = all.find(l => fold(l.title) === w) || all.find(l => fold(l.title).includes(w) || w.includes(fold(l.title))); if (hit) return { list: hit, found: true }; }
  return { list: all[0], found: !name };
}
export async function pending(listName) {
  const { list, found } = await pickList(listName);
  const j = await gfetch(`${API}/lists/${encodeURIComponent(list.id)}/tasks?${new URLSearchParams({ showCompleted: 'false', showHidden: 'false', maxResults: '50' })}`);
  const items = (j?.items || []).filter(t => t.title?.trim()).map(t => ({ id: t.id, title: t.title.trim(), due: t.due || null, notes: t.notes || '' }));
  return { list, found, items };
}
// Todas as pendentes, de todas as listas (para "o que tenho pendente?").
export async function allPending() {
  const out = [];
  for (const l of (await lists()).slice(0, 8)) {
    const j = await gfetch(`${API}/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=false&showHidden=false&maxResults=50`);
    for (const t of j?.items || []) if (t.title?.trim()) out.push({ id: t.id, list: l.title, listId: l.id, title: t.title.trim(), due: t.due || null });
  }
  return out;
}
export async function add(title, listName) {
  let { list, found } = await pickList(listName);
  // "põe leite na lista de compras" sem existir a lista Compras: cria a lista
  if (listName && !found) { const nl = await gfetch(`${API}/users/@me/lists`, { method: 'POST', body: { title: listName.charAt(0).toUpperCase() + listName.slice(1) } }); list = { id: nl.id, title: nl.title }; found = 'criada'; }
  const t = await gfetch(`${API}/lists/${encodeURIComponent(list.id)}/tasks`, { method: 'POST', body: { title: String(title).slice(0, 200) } });
  return { task: { id: t.id, title: t.title }, list, found };
}
// Conclui a tarefa que mais parece com o texto ("risca o leite", "concluí relatório").
export async function complete(text) {
  const w = fold(text), all = await allPending();
  const hit = all.find(t => fold(t.title) === w) || all.find(t => fold(t.title).includes(w)) || all.find(t => w.includes(fold(t.title)));
  if (!hit) return null;
  await gfetch(`${API}/lists/${encodeURIComponent(hit.listId)}/tasks/${encodeURIComponent(hit.id)}`, { method: 'PATCH', body: { status: 'completed' } });
  return hit;
}

// O trecho com os acentos do pedido original ("pao" → "pão").
function restore(folded, original) {
  if (!folded) return '';
  const want = folded.split(' '), orig = String(original).replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean), f = orig.map(fold);
  for (let i = 0; i + want.length <= orig.length; i++) if (want.every((w, k) => f[i + k] === w)) return orig.slice(i, i + want.length).join(' ');
  return folded;
}
// Entende o pedido: { op:'listar', list } | { op:'add', title, list } | { op:'concluir', text } | null
export function parse(text) {
  const r = parseFolded(text);
  if (r?.title) r.title = restore(r.title, text);
  if (r?.list) r.list = restore(r.list, text);
  return r;
}
function parseFolded(text) {
  const t = fold(text).replace(/^(jarvis|ei|por favor) /, '');
  const L = '(?:na|a|minha|da|pra|para a|para|no|em|nas)';
  let m = t.match(new RegExp(`^(?:poe|coloca|coloque|bota|adiciona|adicione|acrescenta|inclui|anota|anote)\\s+(.+?)\\s+${L}\\s+(?:minha\\s+)?lista\\s+(?:de\\s+|do\\s+|da\\s+)?(.+)$`));
  if (m) return { op: 'add', title: m[1].replace(/^(o|a|os|as|um|uma) /, ''), list: m[2] };
  m = t.match(/^(?:adiciona|adicione|cria|crie|anota|anote|nova)\s+(?:uma\s+)?tarefa\s*(?:de|pra|para|:)?\s+(.+)$/);
  if (m) return { op: 'add', title: m[1] };
  m = t.match(/^(?:marca|marque)\s+(.+?)\s+como\s+(?:feit[ao]|concluid[ao]|pront[ao])$/) || t.match(/^(?:risca|risque|conclui|concluir|terminei|ja fiz|fiz)\s+(?:a tarefa\s+|o\s+|a\s+)?(.+)$/);
  if (m && !/\b(pdf|arquivo|site|codigo)\b/.test(m[1])) return { op: 'concluir', text: m[1] };
  m = t.match(/\b(?:o que tem|quais (?:sao )?os itens|o que falta|mostra|ve)\s+(?:na|a)\s+(?:minha\s+)?lista\s+(?:de\s+|do\s+|da\s+)?(.+)$/);
  if (m) return { op: 'listar', list: m[1] };
  if (/\b(minhas tarefas|tarefas pendentes|o que (eu )?tenho (de )?pendente|o que (eu )?tenho pra fazer|lista de tarefas|google tasks)\b/.test(t)) return { op: 'listar' };
  return null;
}
