// Conta JARVIS no app do PC: a mesma conta do site (Google ou e-mail). Com ela, o Jarvis responde usando a chave do
// servidor (pelo site), sem a pessoa precisar de chave própria. Quem tem chave no .env continua usando a sua.
// O passe (90 dias, assinado pelo site) fica em data/conta.json, neste PC. Sair = apagar o passe.
import { randomBytes } from 'node:crypto';
import { readJSON, writeJSON } from './store.js';
import { registerSecret } from './secrets.js';

const FILE = 'conta.json';
export const CONTA = { site: () => String(process.env.JARVIS_CONTA_URL || 'https://jarvis-omega-sand.vercel.app').replace(/\/+$/, ''), fetch: (...a) => fetch(...a) };
let st = null;
const load = () => { if (!st) { st = readJSON(FILE, {}); if (st.token) registerSecret(st.token); } return st; };
const save = () => writeJSON(FILE, st);
export const _reset = () => { st = null; pending.clear(); };

const pending = new Map();   // state -> expira (o "Entrar" que acabou de abrir no navegador)
export const active = () => !!load().token;
export const status = () => { const s = load(); return s.token ? { on: true, name: s.user?.name || '', email: s.user?.email || '', site: CONTA.site(), at: s.at } : { on: false, site: CONTA.site() }; };

// "Entrar com a conta": o navegador abre o site, que devolve o passe para http://localhost:<porta>/auth/conta/volta.
export function start(porta) {
  const state = randomBytes(18).toString('base64url');
  for (const [k, exp] of pending) if (exp < Date.now()) pending.delete(k);
  pending.set(state, Date.now() + 15 * 60_000);
  return `${CONTA.site()}/conectar-app?state=${state}&porta=${porta}`;
}
// Volta do site com o passe: confere o "state" (só vale o Entrar que ESTE app abriu) e pergunta ao site quem é.
export async function finish(state, token) {
  const exp = pending.get(String(state || ''));
  pending.delete(String(state || ''));
  if (!exp || exp < Date.now()) throw Object.assign(new Error('Esse login expirou ou não foi aberto por este app. Clique em "Entrar" de novo.'), { code: 400 });
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,900}\.[A-Za-z0-9_-]{40,60}$/.test(token)) throw Object.assign(new Error('O site não mandou um passe válido.'), { code: 400 });
  const r = await CONTA.fetch(`${CONTA.site()}/api/nuvem/eu`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !j.user) throw Object.assign(new Error('Não consegui confirmar a conta com o site. Tente de novo.'), { code: 502 });
  registerSecret(token);
  st = { token, user: { name: String(j.user.name || '').slice(0, 60), email: String(j.user.email || '').slice(0, 120) }, at: Date.now() };
  save();
  return status();
}
export function logout() { st = {}; save(); return status(); }

// Lembretes guardados no site (Supabase): ele manda o WhatsApp na hora, mesmo com este PC desligado.
async function nuvem(method, p, body) {
  const s = load();
  if (!s.token) throw Object.assign(new Error('Sem conta conectada.'), { code: 401 });
  const r = await CONTA.fetch(`${CONTA.site()}${p}`, { method, signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', 'x-jarvis': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `O site respondeu ${r.status}.`), { code: r.status });
  return j;
}
export const lembreteNuvem = (texto, quando, numero) => nuvem('POST', '/api/nuvem/lembrete', { texto, quando, numero }).then(j => j.id);
export const cancelarLembreteNuvem = id => nuvem('DELETE', '/api/nuvem/lembrete/' + encodeURIComponent(id));

// Jarvis no WhatsApp: ligar o número à conta (o site devolve um código para mandar ao número do Jarvis), ver e desligar.
// pc = este PC aceita pedidos vindos do WhatsApp (o app busca a fila no site enquanto estiver aberto).
export async function vincularWhatsApp(dados) { const j = await nuvem('POST', '/api/nuvem/whatsapp', dados); st.waPc = true; save(); return j; }
export const vinculoWhatsApp = () => nuvem('GET', '/api/nuvem/whatsapp');
export async function desvincularWhatsApp() { const j = await nuvem('DELETE', '/api/nuvem/whatsapp'); st.waPc = false; save(); return j; }
export const waPc = () => !!load().token && !!load().waPc;
export const filaPC = () => nuvem('GET', '/api/nuvem/pc/fila').then(j => j.itens || []);
export const respostaPC = (id, resposta, pendente) => nuvem('POST', '/api/nuvem/pc/fila/' + encodeURIComponent(id), { resposta, pendente: !!pendente });

// Pedido ao Gemini pelo site (mesmo formato do generateContent). Devolve a Response do site, igual à do Google.
export async function gemini(model, request, timeoutMs) {
  const s = load();
  if (!s.token) throw Object.assign(new Error('Sem conta conectada.'), { code: 401 });
  const r = await CONTA.fetch(`${CONTA.site()}/api/nuvem/gemini`, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ model, request }) });
  if (r.status === 401) { st = {}; save(); }   // passe vencido: sai, e o app pede para entrar de novo
  return r;
}
