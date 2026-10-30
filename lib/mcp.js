// Servidores MCP (Model Context Protocol) para o Jarvis Code: o usuário cadastra no painel (Ajustes) e o modo Code
// passa a usar as ferramentas deles ("lista minhas issues do GitHub", "lê o arquivo X do servidor de arquivos"...).
// Dois transportes: stdio (um programa local, ex.: npx @modelcontextprotocol/server-filesystem) e HTTP (Streamable HTTP).
// Segurança:
//   - servidores só entram pelo painel (POST com o cabeçalho próprio), nunca por voz nem pela IA;
//   - ferramentas que ALTERAM coisas (sem readOnlyHint) só rodam se o usuário ligar "permitir ações" naquele servidor;
//   - variáveis e cabeçalhos (tokens) ficam em data/mcp.json, nunca voltam para a página e são apagados dos logs;
//   - o resultado da ferramenta é DADO para a IA, nunca ordem.
import { spawn } from 'node:child_process';
import { readJSON, writeJSON } from './store.js';
import { registerSecret, mask, log } from './secrets.js';

export const MCP = { timeout: 30_000, startTimeout: 45_000, maxServers: 12, maxResult: 6000 };
const FILE = 'mcp.json';
const PROTOCOL = '2025-06-18';
const NAME_RX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const str = (v, n) => String(v ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, n);
const conns = new Map();   // nome -> Conn

function load() { const d = readJSON(FILE, { servers: [] }); return Array.isArray(d.servers) ? d.servers : []; }
function save(list) { writeJSON(FILE, { servers: list }); }
for (const s of load()) for (const v of [...Object.values(s.env || {}), ...Object.values(s.headers || {})]) registerSecret(v);

// "a b 'c d'" -> ['a','b','c d'] (argumentos digitados numa linha só).
export function splitArgs(s) {
  const out = []; let cur = '', q = null, has = false;
  for (const ch of String(s || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out.slice(0, 40);
}
// "CHAVE=valor" por linha -> { CHAVE: 'valor' }
export function parsePairs(s, sep = '=') {
  const o = {};
  for (const line of String(s || '').split(/\r?\n/)) {
    const i = line.indexOf(sep); if (i < 1) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (/^[A-Za-z_][\w-]{0,63}$/.test(k) && v.length <= 4000) o[k] = v;
  }
  return o;
}

// Valida o cadastro vindo do painel. Lança { code: 400 } com a mensagem para o usuário.
export function cleanServer(b) {
  const bad = m => { const e = new Error(m); e.code = 400; throw e; };
  const name = str(b?.name, 40).toLowerCase().replace(/\s+/g, '-');
  if (!NAME_RX.test(name)) bad('Nome inválido: use letras, números, - ou _ (até 32).');
  const type = b?.type === 'http' ? 'http' : 'stdio';
  const s = { name, type, enabled: true, write: b?.write === true };
  if (type === 'http') {
    let u; try { u = new URL(str(b.url, 500)); } catch { bad('Endereço inválido. Ex.: https://exemplo.com/mcp'); }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) bad('Use https:// (http só para localhost).');
    if (u.username || u.password) bad('Não coloque usuário e senha no endereço: use os cabeçalhos.');
    s.url = u.href;
    s.headers = typeof b.headers === 'string' ? parsePairs(b.headers, ':') : {};
  } else {
    const command = str(b.command, 260);
    if (!command) bad('Diga o comando que inicia o servidor (ex.: npx).');
    if (/[|&;<>`^%\r\n]/.test(command)) bad('O comando é só o programa (ex.: npx, node, uvx); os argumentos vão no campo de baixo.');
    s.command = command;
    s.args = Array.isArray(b.args) ? b.args.map(a => str(a, 500)).slice(0, 40) : splitArgs(b.args);
    if (s.args.some(a => /[\r\n]/.test(a))) bad('Argumento inválido.');
    s.env = typeof b.env === 'string' ? parsePairs(b.env) : {};
  }
  return s;
}

export function add(b) {
  const s = cleanServer(b), list = load();
  if (list.length >= MCP.maxServers && !list.some(x => x.name === s.name)) { const e = new Error(`No máximo ${MCP.maxServers} servidores.`); e.code = 400; throw e; }
  for (const v of [...Object.values(s.env || {}), ...Object.values(s.headers || {})]) registerSecret(v);
  stopConn(s.name);
  save([...list.filter(x => x.name !== s.name), s]);
  return s.name;
}
export function remove(name) { stopConn(name); save(load().filter(x => x.name !== name)); }
export function setFlag(name, flag, on) {
  if (!['enabled', 'write'].includes(flag)) return;
  const list = load(), s = list.find(x => x.name === name); if (!s) return;
  s[flag] = on === true; save(list);
  if (flag === 'enabled' && !s.enabled) stopConn(name);
}

/* ---------- Conexão (JSON-RPC 2.0) ---------- */
class Conn {
  constructor(cfg) { this.cfg = cfg; this.seq = 0; this.wait = new Map(); this.tools = []; this.error = ''; this.ready = null; this.session = null; }
  start() {
    if (!this.ready) this.ready = this._init().catch(e => { this.error = str(e.message, 200) || 'falhou'; this.ok = false; this.close(); this.ready = null; throw e; });
    return this.ready;
  }
  async _init() {
    if (this.cfg.type === 'stdio') this._spawn();
    const info = await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'jarvis', version: '3.0.0' } }, MCP.startTimeout);
    this.server = str(info?.serverInfo?.name, 60);
    await this.notify('notifications/initialized');
    await this.refreshTools();
    this.error = ''; this.ok = true;
  }
  async refreshTools() {
    const all = []; let cursor;
    for (let i = 0; i < 5; i++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      all.push(...(Array.isArray(r?.tools) ? r.tools : [])); cursor = r?.nextCursor; if (!cursor) break;
    }
    this.tools = all.slice(0, 80).map(t => ({ name: str(t.name, 64), description: str(t.description, 300), schema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
      readOnly: t.annotations?.readOnlyHint === true, destructive: t.annotations?.destructiveHint === true })).filter(t => t.name);
  }
  _spawn() {
    const { command, args = [], env = {} } = this.cfg;
    // No Windows, npx/npm/uvx são .cmd: precisam passar pelo cmd.exe (sem shell o Node recusa .cmd).
    const win = process.platform === 'win32' && !/\.exe$/i.test(command) && !/[\\/]/.test(command) || /\.(cmd|bat)$/i.test(command);
    const [cmd, argv] = win ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command, ...args]] : [command, args];
    const p = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p; let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      buf += d; if (buf.length > 8_000_000) buf = '';
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) this._msg(line); }
    });
    let errTail = '';
    p.stderr.setEncoding('utf8'); p.stderr.on('data', d => { errTail = (errTail + d).slice(-400); });
    p.on('error', e => this._fail(e.code === 'ENOENT' ? `Não achei o programa "${command}". Ele está instalado?` : e.message));
    p.on('exit', code => this._fail(`O servidor fechou (código ${code})${errTail ? `: ${errTail.trim().split('\n').pop()}` : ''}`));
  }
  _fail(msg) {
    this.error = str(msg, 200); this.ok = false; this.proc = null; this.ready = null;
    for (const [, w] of this.wait) w.reject(new Error(this.error));
    this.wait.clear();
  }
  _msg(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m && m.id != null && this.wait.has(m.id) && ('result' in m || 'error' in m)) {
      const w = this.wait.get(m.id); this.wait.delete(m.id);
      if (m.error) w.reject(new Error(str(m.error.message, 200) || 'erro do servidor')); else w.resolve(m.result);
    } else if (m && m.method && m.id != null && this.proc) {
      // Pedidos do servidor (sampling, roots...): não oferecemos nada.
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'não suportado' } }) + '\n');
    }
  }
  request(method, params = {}, ms = MCP.timeout) {
    const id = ++this.seq, body = { jsonrpc: '2.0', id, method, params };
    if (this.cfg.type === 'http') return this._http(body, ms);
    if (!this.proc) return Promise.reject(new Error(this.error || 'servidor parado'));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.wait.delete(id); reject(new Error('o servidor demorou demais para responder')); }, ms);
      this.wait.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.proc.stdin.write(JSON.stringify(body) + '\n');
    });
  }
  async notify(method, params) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    if (this.cfg.type === 'http') { try { await this._post(body, 10_000); } catch { /* notificação: sem resposta */ } return; }
    this.proc?.stdin.write(JSON.stringify(body) + '\n');
  }
  async _post(body, ms) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(this.cfg.headers || {}), ...(this.session ? { 'mcp-session-id': this.session } : {}) };
    const r = await fetch(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms), redirect: 'error' });
    const sid = r.headers.get('mcp-session-id'); if (sid) this.session = sid.slice(0, 200);
    return r;
  }
  async _http(body, ms) {
    const r = await this._post(body, ms);
    if (r.status === 401 || r.status === 403) throw new Error('acesso negado: confira o token nos cabeçalhos');
    if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
    const text = (await r.text()).slice(0, 8_000_000);
    const msgs = /text\/event-stream/.test(r.headers.get('content-type') || '')
      ? text.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
      : [(() => { try { return JSON.parse(text); } catch { return null; } })()];
    const m = msgs.flat().find(x => x && x.id === body.id);
    if (!m) throw new Error('resposta inválida do servidor');
    if (m.error) throw new Error(str(m.error.message, 200) || 'erro do servidor');
    return m.result;
  }
  close() {
    for (const [, w] of this.wait) w.reject(new Error('fechado'));
    this.wait.clear();
    if (this.proc) { const p = this.proc; this.proc = null; try { p.stdin.end(); p.kill(); } catch { /* já saiu */ } }
    if (this.cfg.type === 'http' && this.session) { fetch(this.cfg.url, { method: 'DELETE', headers: { 'mcp-session-id': this.session, ...(this.cfg.headers || {}) } }).catch(() => {}); this.session = null; }
  }
}
function stopConn(name) { const c = conns.get(name); if (c) { c.close(); conns.delete(name); } }
export function closeAll() { for (const n of [...conns.keys()]) stopConn(n); }

async function connect(s) {
  let c = conns.get(s.name);
  if (c && JSON.stringify(c.cfg) !== JSON.stringify(s)) { stopConn(s.name); c = null; }
  if (!c || (!c.ready && c.error)) { c = new Conn(s); conns.set(s.name, c); }
  await c.start();
  return c;
}

// Conecta (se precisar) em todos os ligados. Erros ficam no status; nunca derrubam o resto.
export async function ensureAll() {
  await Promise.all(load().filter(s => s.enabled).map(s => connect(s).catch(e => log.warn(`MCP ${s.name}: ${e.message}`))));
}
export async function refresh(name) {
  const s = load().find(x => x.name === name); if (!s) return;
  stopConn(name);
  if (s.enabled) await connect(s).catch(() => {});
}

// Para o painel: nada de valores de variáveis ou cabeçalhos (só os nomes, mascarados).
export function status() {
  return load().map(s => {
    const c = conns.get(s.name);
    return { name: s.name, type: s.type, enabled: s.enabled !== false, write: s.write === true,
      where: s.type === 'http' ? s.url : [s.command, ...(s.args || [])].join(' ').slice(0, 200),
      secrets: Object.entries(s.type === 'http' ? s.headers || {} : s.env || {}).map(([k, v]) => `${k} ${mask(v) || ''}`.trim()),
      state: !s.enabled ? 'desligado' : c?.error ? 'erro' : c?.ok ? 'conectado' : c?.ready ? 'conectando' : 'parado',
      error: c?.error || '', server: c?.server || '',
      tools: (c?.tools || []).map(t => ({ name: t.name, description: t.description.slice(0, 140), readOnly: t.readOnly })) };
  });
}
export const count = () => load().filter(s => s.enabled !== false).length;

// Catálogo para o prompt do modo Code: "servidor/ferramenta (args) [só leitura|altera]: descrição".
export function catalog(limit = 60) {
  const out = [];
  for (const s of load()) {
    if (!s.enabled) continue;
    const c = conns.get(s.name); if (!c?.tools?.length) continue;
    for (const t of c.tools) {
      const props = t.schema?.properties && typeof t.schema.properties === 'object' ? Object.entries(t.schema.properties).slice(0, 10) : [];
      const req = new Set(Array.isArray(t.schema?.required) ? t.schema.required : []);
      const args = props.map(([k, v]) => `${k}${req.has(k) ? '' : '?'}:${str(v?.type || 'any', 12)}`).join(', ');
      const kind = t.readOnly ? 'só leitura' : s.write ? 'altera coisas' : 'altera coisas, BLOQUEADA';
      out.push(`${s.name}/${t.name}(${args}) [${kind}]: ${t.description.slice(0, 160)}`);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Chama uma ferramenta. Devolve { ok, text } (texto já truncado) ou lança { code, message } amigável.
export async function callTool(server, tool, args = {}) {
  const bad = (m, code = 400) => { const e = new Error(m); e.code = code; throw e; };
  const s = load().find(x => x.name === str(server, 40).toLowerCase());
  if (!s) bad(`Não tenho um servidor MCP chamado "${str(server, 40)}".`, 404);
  if (!s.enabled) bad(`O servidor MCP ${s.name} está desligado no painel.`);
  const c = await connect(s).catch(e => bad(`Não consegui conectar no servidor MCP ${s.name}: ${e.message}`, 502));
  const t = c.tools.find(x => x.name === str(tool, 64));
  if (!t) bad(`O servidor ${s.name} não tem a ferramenta "${str(tool, 64)}".`, 404);
  if (!t.readOnly && !s.write) bad(`A ferramenta ${t.name} altera coisas e o servidor ${s.name} só tem permissão de leitura. Ligue "permitir ações" nele, em Ajustes, se quiser.`, 403);
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (JSON.stringify(a).length > 20_000) bad('Argumentos grandes demais.');
  for (const k of Array.isArray(t.schema?.required) ? t.schema.required : []) if (!(k in a)) bad(`Falta o argumento "${k}" para ${t.name}.`);
  let r;
  try { r = await c.request('tools/call', { name: t.name, arguments: a }); } catch (e) { bad(`A ferramenta ${t.name} falhou: ${e.message}`, 502); }
  const parts = (Array.isArray(r?.content) ? r.content : []).map(p => p?.type === 'text' ? String(p.text || '')
    : p?.type === 'resource' ? String(p.resource?.text || p.resource?.uri || '') : p?.type ? `[${p.type}]` : '').filter(Boolean);
  let text = parts.join('\n') || (r?.structuredContent ? JSON.stringify(r.structuredContent) : '');
  if (text.length > MCP.maxResult) text = text.slice(0, MCP.maxResult) + '\n…(cortado)';
  return { ok: r?.isError !== true, text, tool: t.name, server: s.name, readOnly: t.readOnly };
}
