// Jarvis no WhatsApp (site na Vercel): a Meta avisa cada mensagem recebida (webhook) e o site responde com o mesmo Jarvis da
// web. Só números ligados a uma conta JARVIS são atendidos (código de 6 dígitos gerado no site ou no app). Tudo no Supabase:
//   jarvis_wa_contas  número -> conta, perfil, logins (cifrados), histórico curto e pedido pendente
//   jarvis_wa_codigos códigos de ligação (15 min)
//   jarvis_wa_msgs    IDs já atendidos (a Meta reenvia quando demora)
//   jarvis_pc_fila    pedidos do WhatsApp que só o PC faz (o app aberto busca e responde)
// .env da Vercel: WHATSAPP_APP_SECRET (assina os avisos da Meta) e WHATSAPP_VERIFY_TOKEN (você inventa; vai no painel).
import crypto from 'node:crypto';
import { db, dbOn } from './cloudrem.js';
import * as whatsapp from './whatsapp.js';
import { seal, open } from './webtokens.js';
import { registerSecret } from './secrets.js';

export const SQL = `create table if not exists public.jarvis_wa_contas (
  numero text primary key,
  uid text not null,
  nome text,
  perfil jsonb,
  tokens text,
  historico jsonb,
  pend text,
  pcpend boolean not null default false,
  pc boolean not null default false,
  criado timestamptz not null default now(),
  atualizado timestamptz not null default now()
);
create index if not exists jarvis_wa_contas_uid on public.jarvis_wa_contas (uid);
create table if not exists public.jarvis_wa_codigos (
  codigo text primary key,
  uid text not null,
  dados text,
  exp timestamptz not null
);
create table if not exists public.jarvis_wa_msgs (
  id text primary key,
  criado timestamptz not null default now()
);
create table if not exists public.jarvis_pc_fila (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  numero text not null,
  texto text not null,
  estado text not null default 'pendente',
  resposta text,
  criado timestamptz not null default now(),
  feito timestamptz
);
create index if not exists jarvis_pc_fila_uid on public.jarvis_pc_fila (uid, estado);
alter table public.jarvis_wa_contas enable row level security;
alter table public.jarvis_wa_codigos enable row level security;
alter table public.jarvis_wa_msgs enable row level security;
alter table public.jarvis_pc_fila enable row level security;`;

const env = k => String(process.env[k] || '').trim();
export const on = () => dbOn() && whatsapp.configured() && env('WHATSAPP_APP_SECRET').length >= 16;
const q = encodeURIComponent;
const uidOk = u => /^[\w-]{1,80}$/.test(String(u || ''));

/* ---------- aviso da Meta ---------- */
// X-Hub-Signature-256 = "sha256=" + HMAC(corpo cru, App Secret). Sem o segredo configurado, nada é aceito.
export function verifySig(raw, header) {
  const s = env('WHATSAPP_APP_SECRET'); if (s.length < 16) return false;
  registerSecret(s);
  const want = 'sha256=' + crypto.createHmac('sha256', s).update(raw).digest('hex'), got = String(header || '');
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export const verifyToken = t => { const v = env('WHATSAPP_VERIFY_TOKEN'); return v.length >= 8 && String(t || '') === v; };
// As mensagens de texto/áudio/botão de um aviso (ignora status de entregue/lido).
export function messages(body) {
  const out = [];
  for (const e of body?.entry || []) for (const c of e.changes || []) {
    const v = c.value || {};
    if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== env('WHATSAPP_PHONE_ID')) continue;   // outro número
    for (const m of v.messages || []) {
      const from = String(m.from || '').replace(/\D/g, '');
      if (!from || !m.id) continue;
      const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : null;
      out.push({ id: String(m.id), from, type: m.type, text: text ? String(text).slice(0, 1500) : '', audio: m.type === 'audio' ? m.audio?.id : null, nome: v.contacts?.find(x => x.wa_id === m.from)?.profile?.name || '' });
    }
  }
  return out;
}
// Já atendida? (a Meta reenvia o mesmo aviso se a resposta demora)
export async function firstTime(id) {
  const r = await db('jarvis_wa_msgs', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { id: String(id).slice(0, 200) } });
  return Array.isArray(r) && r.length > 0;
}
// Áudio (nota de voz): baixa da Meta para transcrever. Nunca é guardado.
export async function media(id) {
  const t = env('WHATSAPP_TOKEN');
  const r = await fetch(`https://graph.facebook.com/v21.0/${q(id)}`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !/^https:\/\//.test(j.url || '')) throw new Error('Não consegui baixar o áudio.');
  if (Number(j.file_size) > 8 * 1024 * 1024) throw new Error('Áudio grande demais.');
  const a = await fetch(j.url, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
  if (!a.ok) throw new Error('Não consegui baixar o áudio.');
  return { mime: String(j.mime_type || 'audio/ogg').split(';')[0], buf: Buffer.from(await a.arrayBuffer()) };
}

/* ---------- ligação número <-> conta ---------- */
// O site/app gera o código; a pessoa manda "JARVIS 123456" para o número do Jarvis. dados = perfil e logins (cifrados).
export async function newCode(uid, dados) {
  if (!uidOk(uid)) throw Object.assign(new Error('Conta inválida.'), { code: 400 });
  await db(`jarvis_wa_codigos?uid=eq.${q(uid)}`, { method: 'DELETE' });
  const codigo = String(crypto.randomInt(100000, 1000000));
  await db('jarvis_wa_codigos', { method: 'POST', body: { codigo, uid, dados: seal(dados || {}), exp: new Date(Date.now() + 15 * 60_000).toISOString() } });
  return codigo;
}
export async function useCode(codigo, numero) {
  const [c] = await db(`jarvis_wa_codigos?codigo=eq.${q(codigo)}&select=uid,dados,exp`) || [];
  if (!c || Date.parse(c.exp) < Date.now()) return null;
  await db(`jarvis_wa_codigos?codigo=eq.${q(codigo)}`, { method: 'DELETE' });
  const d = open(c.dados) || {};
  await db(`jarvis_wa_contas?uid=eq.${q(c.uid)}`, { method: 'DELETE' });   // um número por conta
  const row = { numero, uid: c.uid, nome: String(d.nome || '').slice(0, 60), perfil: d.perfil || {}, tokens: d.tokens && Object.keys(d.tokens).length ? seal(d.tokens) : null, historico: [], pend: null, pcpend: false, pc: !!d.pc, atualizado: new Date().toISOString() };
  await db('jarvis_wa_contas', { method: 'POST', prefer: 'resolution=merge-duplicates', body: row });
  return row;
}
export async function account(numero) { const [a] = await db(`jarvis_wa_contas?numero=eq.${q(numero)}&select=*`) || []; return a || null; }
export async function accountByUid(uid) { if (!uidOk(uid)) return null; const [a] = await db(`jarvis_wa_contas?uid=eq.${q(uid)}&select=numero,nome,pc,criado`) || []; return a || null; }
export const save = (numero, patch) => db(`jarvis_wa_contas?numero=eq.${q(numero)}`, { method: 'PATCH', body: { ...patch, atualizado: new Date().toISOString() } });
export const unlinkUid = uid => db(`jarvis_wa_contas?uid=eq.${q(uid)}`, { method: 'DELETE' });
export const unlinkNumber = numero => db(`jarvis_wa_contas?numero=eq.${q(numero)}`, { method: 'DELETE' });
export const tokensOf = a => (a?.tokens ? open(a.tokens) || {} : {});
// Login do Google/Spotify renovado ou conectado na web: a cópia do WhatsApp acompanha.
export async function saveTokensUid(uid, tokens) {
  if (!uidOk(uid)) return;
  await db(`jarvis_wa_contas?uid=eq.${q(uid)}`, { method: 'PATCH', body: { tokens: tokens && Object.keys(tokens).length ? seal(tokens) : null, atualizado: new Date().toISOString() } });
}
export async function savePerfilUid(uid, perfil) { if (uidOk(uid)) await db(`jarvis_wa_contas?uid=eq.${q(uid)}`, { method: 'PATCH', body: { perfil, atualizado: new Date().toISOString() } }); }

/* ---------- fila do PC ---------- */
export async function enqueue(uid, numero, texto) {
  const pend = await db(`jarvis_pc_fila?uid=eq.${q(uid)}&estado=eq.pendente&select=id&limit=20`) || [];
  if (pend.length >= 20) throw Object.assign(new Error('Fila do PC cheia.'), { code: 429 });
  const [r] = await db('jarvis_pc_fila', { method: 'POST', prefer: 'return=representation', body: { uid, numero, texto: String(texto).slice(0, 1000) } });
  return r.id;
}
// O app pega os pendentes (e marca como "fazendo" para não pegar duas vezes).
export async function take(uid) {
  if (!uidOk(uid)) return [];
  const rows = await db(`jarvis_pc_fila?uid=eq.${q(uid)}&estado=eq.pendente&order=criado.asc&limit=5&select=id,texto,criado`) || [];
  const out = [];
  for (const r of rows) {
    const c = await db(`jarvis_pc_fila?id=eq.${r.id}&estado=eq.pendente`, { method: 'PATCH', prefer: 'return=representation', body: { estado: 'fazendo' } });
    if (c?.length) out.push({ id: r.id, texto: r.texto });
  }
  return out;
}
export async function finish(uid, id, resposta) {
  if (!uidOk(uid) || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const [r] = await db(`jarvis_pc_fila?id=eq.${id}&uid=eq.${q(uid)}&estado=eq.fazendo`, { method: 'PATCH', prefer: 'return=representation', body: { estado: 'feito', resposta: String(resposta || '').slice(0, 4000), feito: new Date().toISOString() } }) || [];
  return r || null;
}
// Pedidos que o PC não pegou em 3 minutos (desligado ou app fechado).
export async function stale(now = Date.now()) {
  const rows = await db(`jarvis_pc_fila?estado=eq.pendente&criado=lte.${q(new Date(now - 3 * 60_000).toISOString())}&select=id,numero,texto&limit=20`) || [];
  const out = [];
  for (const r of rows) { const c = await db(`jarvis_pc_fila?id=eq.${r.id}&estado=eq.pendente`, { method: 'PATCH', prefer: 'return=representation', body: { estado: 'expirado' } }); if (c?.length) out.push(r); }
  return out;
}
