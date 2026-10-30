// Caixa de correio do Jarvis: o que ele te entrega e o que você mandou para ele.
// - Do Jarvis: arquivos que ele criou ou editou (o Jarvis Code digitando no VS Code, ou gravados direto). Ficam no disco,
//   e aqui só fica o caminho (data/correio.json lembra a lista entre uma abertura e outra; nunca o conteúdo).
// - Seus: os arquivos que você soltou na janela ou mandou pelo botão. Só na memória (como os anexos), somem ao fechar.
// "Me manda o arquivo" (por voz ou texto) entrega a carta: ela volta ao topo como nova e o Jarvis Code vem de carteiro.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const LIMITS = { items: 60, memBytes: 40_000_000 };
const box = [];   // mais nova primeiro
let FILE = null;

const kindOf = n => /\.pdf$/i.test(n) ? 'pdf' : /\.(png|jpe?g|gif|webp|bmp)$/i.test(n) ? 'image' : /\.(html?|css|m?js|jsx|tsx?|py|cs|java|c|cpp|h|go|rs|php|rb|lua|sh|ps1|bat|sql|json|xml|ya?ml|toml)$/i.test(n) ? 'code' : 'text';
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml' };
const mimeOf = n => MIME[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';
const sizeOf = p => { try { return fs.statSync(p).size; } catch { return 0; } };

export function init(dataDir) {
  FILE = path.join(dataDir, 'correio.json');
  try {
    for (const x of JSON.parse(fs.readFileSync(FILE, 'utf8')))
      if (x && x.id && x.path && fs.existsSync(x.path)) box.push({ ...x, size: sizeOf(x.path) });
  } catch { /* primeira vez */ }
}
function save() {
  if (!FILE) return;
  try { fs.writeFileSync(FILE, JSON.stringify(box.filter(x => x.path).map(({ data, ...x }) => x), null, 1)); } catch { /* sem disco: segue na memória */ }
}
function trim() {
  while (box.length > LIMITS.items) box.pop();
  let mem = 0;
  for (let i = 0; i < box.length; i++) if (box[i].data) { mem += box[i].data.length; if (mem > LIMITS.memBytes) { box.splice(i, 1); i--; } }
}

export const pub = x => ({ id: x.id, name: x.name, from: x.from, kind: x.kind, at: x.at, novo: !!x.novo, size: x.size || 0, disco: !!x.path, ...(x.note ? { note: x.note } : {}) });

// Põe uma carta na caixa. path: arquivo no disco (do Jarvis). data: Buffer (o que você mandou).
export function deliver({ from = 'jarvis', name, path: p, data, note } = {}) {
  if (!p && !Buffer.isBuffer(data)) throw new Error('Carta sem arquivo.');
  name = (typeof name === 'string' && name ? name : p ? path.basename(String(p)) : 'arquivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'arquivo';
  if (p) { const i = box.findIndex(x => x.path === p); if (i >= 0) box.splice(i, 1); }   // o mesmo arquivo de novo (editado): a carta antiga sai
  const item = { id: randomBytes(8).toString('hex'), name, from: from === 'voce' ? 'voce' : 'jarvis', kind: kindOf(name), at: Date.now(), novo: true,
    ...(p ? { path: p, size: sizeOf(p) } : { data, size: data.length }), ...(note ? { note: String(note).slice(0, 80) } : {}) };
  box.unshift(item); trim(); save();
  return pub(item);
}

export const list = () => box.map(pub);
export const count = () => ({ total: box.length, novas: box.filter(x => x.novo).length });
const get = id => box.find(x => x.id === String(id));

// Conteúdo para baixar. Arquivo do disco que sumiu (apagado, movido): a carta sai da caixa.
export function content(id) {
  const x = get(id); if (!x) return null;
  if (x.path) {
    try { return { buf: fs.readFileSync(x.path), name: x.name, mime: mimeOf(x.name) }; }
    catch { remove(id); return null; }
  }
  return { buf: x.data, name: x.name, mime: mimeOf(x.name) };
}
export const pathOf = id => get(id)?.path || null;
export function remove(id) { const i = box.findIndex(x => x.id === String(id)); if (i < 0) return false; box.splice(i, 1); save(); return true; }
export function markSeen(id) { for (const x of box) if (!id || x.id === id) x.novo = false; save(); }

// "Entregar de novo": a carta volta ao topo, marcada como nova.
export function redeliver(id) {
  const i = box.findIndex(x => x.id === String(id)); if (i < 0) return null;
  const [x] = box.splice(i, 1); x.novo = true; x.at = Date.now(); box.unshift(x); save();
  return pub(x);
}

// Qual carta o pedido quer ("me manda o html", "devolve o PDF que eu mandei", "manda o jogo.py"):
// nome citado > tipo citado > de quem > a mais nova do Jarvis > a mais nova de todas.
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function pick(text) {
  const t = fold(text);
  if (!box.length) return null;
  const byName = box.find(x => { const n = fold(x.name), base = n.replace(/\.[^.]+$/, ''); return t.includes(n) || (base.length >= 4 && t.includes(base)); });
  if (byName) return byName;
  const mine = /\b(que eu (te )?(mandei|enviei|passei)|meu|minha|meus|minhas)\b/.test(t);
  const pool = box.filter(x => mine ? x.from === 'voce' : true);
  const ext = (t.match(/\b(pdf|html|css|js|py|json|txt|csv|png|jpg|imagem|foto|codigo)\b/) || [])[1];
  if (ext) {
    const hit = pool.find(x => ext === 'imagem' || ext === 'foto' ? x.kind === 'image' : ext === 'codigo' ? x.kind === 'code' : fold(x.name).endsWith('.' + ext));
    if (hit) return hit;
  }
  return (mine ? pool[0] : box.find(x => x.from === 'jarvis')) || box[0];
}

// O pedido é para o correio? (antes de virar conversa ou "olhar a tela")
const SEND_RX = /\b(me\s+)?(manda|mande|envia|envie|entrega|entregue|devolve|devolva|passa|passe|traz|traga)\b(\s+\w+){0,6}?\s+(o|a|os|as|esse|essa|esses|essas|aquele|aquela|meu|minha)?\s*\b(arquivo|arquivos|pdf|documento|documentos|codigo|html|css|script|imagem|foto|carta)\b/;
const OPEN_RX = /\b(abre|abra|abrir|mostra|mostre|ver|veja|olha)\b(\s+\w+){0,3}?\s+\b(correio|caixa de correio|caixa postal|correspondencia|cartas)\b/;
export function isRequest(text) {
  const t = fold(text);
  if (/\b(e-?mail|email|gmail|whatsapp|mensagem|zap)\b/.test(t)) return null;   // isso é com o e-mail, não com o correio
  if (SEND_RX.test(t)) return 'enviar';
  if (OPEN_RX.test(t)) return 'abrir';
  return null;
}
