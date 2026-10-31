// Mascote da área de trabalho (JarvisDesktop.exe): eventos em tempo real por SSE.
// O mascote conecta em GET /api/mascot/events?apps=<apelidos da allowlist dele> e recebe:
//   pensando_inicio {}, acao {id, acao:'abrir_app'|'abrir_url'|'escrever'|'clicar'|'rolar'|'digitar'|'tecla', ...}, capturar {id, monitor?, inteiro?}, concluido {}, erro {mensagem}
// O resultado volta por POST /api/mascot/result {id, status: ok|cancelado|erro|nao_permitido, detalhe}.
import { randomBytes } from 'node:crypto';
import { log } from './secrets.js';

const clients = new Set();   // { res, aliases:Set, ping }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pending = new Map();   // id -> { at, label }
const waiters = new Map();   // id -> resolve(status) de quem espera o resultado

export function attach(req, res, appsParam, headers = {}, screen = false, write = false, click = false, keys = false) {
  const aliases = new Set(String(appsParam || '').split(',').map(norm).filter(a => a && a.length <= 40).slice(0, 80));
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': conectado\n\n');
  const c = { res, aliases, screen: !!screen, write: !!write, click: !!click, keys: !!keys, ping: setInterval(() => { try { res.write(': ping\n\n'); } catch { /* fechado */ } }, 20_000) };
  clients.add(c);
  log.info(`Mascote conectado (${aliases.size} apelidos de apps).`);
  const bye = () => { clearInterval(c.ping); if (clients.delete(c)) log.info('Mascote desconectado.'); };
  req.on('close', bye); res.on('error', bye);
}

export const connected = () => clients.size > 0;
// O mascote sabe abrir esse app? (só delegamos o que está na allowlist dele)
export const canOpen = alias => [...clients].some(c => c.aliases.has(norm(alias)));
// O mascote sabe escrever um arquivo nesse app (declarou escrever=1 na conexão)?
// O Jarvis Code sabe clicar (declarou clicar=1) e ler a tela (para escolher onde)?
export const canClick = () => [...clients].some(c => c.click && c.screen);
// Tarefas de vários passos: além de clicar, digitar o que o usuário falou e apertar teclas de uma lista fixa (declarou teclado=1).
export const canType = () => [...clients].some(c => c.keys && c.click && c.screen);
export const canWrite = alias => [...clients].some(c => c.write && c.aliases.has(norm(alias)));

export function emit(type, data = {}) {
  if (!clients.size) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.res.write(msg); } catch { /* o 'close' limpa */ } }
}

// Envia uma ação e devolve o id (para casar com o resultado depois).
export function action(data, label = '') {
  const id = randomBytes(6).toString('hex');
  pending.set(id, { at: Date.now(), label });
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  emit('acao', { id, ...data });
  return id;
}

// Espera o resultado de uma ação (ex.: abrir o YouTube antes de olhar a tela). Sem resposta no prazo: 'tempo'.
export function waitResult(id, ms = 30_000) {
  return new Promise(ok => { const t = setTimeout(() => { waiters.delete(id); ok('tempo'); }, ms); waiters.set(id, s => { clearTimeout(t); ok(s); }); });
}

const STATUS = new Set(['ok', 'cancelado', 'erro', 'nao_permitido']);
export function result(b) {
  const id = String(b?.id || ''), status = String(b?.status || '');
  if (!/^[a-f0-9]{12}$/.test(id) || !STATUS.has(status)) return false;
  const p = pending.get(id); pending.delete(id);
  const w = waiters.get(id); if (w) { waiters.delete(id); w(status); }
  log.info(`Mascote: ${p?.label || id} → ${status}${b.detalhe ? ` (${String(b.detalhe).slice(0, 120)})` : ''}`);
  return true;
}

/* ---------- Ler a tela onde o mascote está (só quando o usuário pede; nada é gravado) ---------- */
const captures = new Map();   // id -> { resolve, reject, timer }
export const canCapture = () => [...clients].some(c => c.screen);
export function capture(ms = 6000, monitor = null, whole = false) {   // whole: o monitor inteiro, mesmo em cima de uma janela (tarefas)   // monitor: 1 = principal, 2, 3... (sem: a janela em que o Jarvis Code está, ou o monitor dele)
  return new Promise((resolve, reject) => {
    const id = randomBytes(6).toString('hex');
    const timer = setTimeout(() => { captures.delete(id); reject(Object.assign(new Error('O mascote não mandou a imagem a tempo.'), { code: 504 })); }, ms);
    captures.set(id, { resolve, reject, timer });
    emit('capturar', { id, ...(monitor ? { monitor } : {}), ...(whole ? { inteiro: true } : {}) });
  });
}
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
export function captureResult(b) {
  const id = String(b?.id || ''), c = captures.get(id);
  if (!c) return false;
  captures.delete(id); clearTimeout(c.timer);
  if (b.erro) { c.reject(Object.assign(new Error(String(b.erro).slice(0, 160)), { code: 502 })); return true; }
  const image = typeof b.image === 'string' && b.image.length < 3_500_000 && JPEG.test(b.image) ? b.image : null;
  if (!image) { c.reject(Object.assign(new Error('Imagem inválida.'), { code: 400 })); return true; }
  c.resolve({ id, image, janela: String(b.janela || '').replace(/[\x00-\x1f]/g, ' ').slice(0, 120) });
  return true;
}

export function closeAll() { for (const c of clients) { clearInterval(c.ping); try { c.res.end(); } catch { /* já fechado */ } } clients.clear(); }

/* ---------- Janela flutuante do Jarvis (/app?mini=1) ----------
   O Jarvis Desktop manda "falar" (atalho de teclado global) e a janela flutuante começa a ouvir.
   O fluxo só leva esse aviso, sem dado nenhum: uma página de outro site não consegue nem lê-lo (EventSource sem CORS). */
const uiClients = new Set();
export function uiAttach(req, res, headers = {}) {
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': conectado\n\n');
  const c = { res, ping: setInterval(() => { try { res.write(': ping\n\n'); } catch { /* fechado */ } }, 20_000) };
  uiClients.add(c);
  const bye = () => { clearInterval(c.ping); uiClients.delete(c); };
  req.on('close', bye); res.on('error', bye);
}
// jogo: a partida começou ou acabou (a página consulta /api/game); acordar: chamado por "Jarvis";
// arquivo: solto no V do Jarvis Desktop (a página põe na fila do próximo pedido); fimv: o V sumiu.
export function uiEmit(type, data = {}) {
  if (!['falar', 'parar', 'jogo', 'acordar', 'arquivo', 'fimv', 'correio', 'lembrete'].includes(type)) return 0;
  const json = JSON.stringify(data || {});
  for (const c of uiClients) { try { c.res.write(`event: ${type}\ndata: ${json}\n\n`); } catch { /* o 'close' limpa */ } }
  return uiClients.size;
}
export function closeUi() { for (const c of uiClients) { clearInterval(c.ping); try { c.res.end(); } catch { /* já fechado */ } } uiClients.clear(); }
