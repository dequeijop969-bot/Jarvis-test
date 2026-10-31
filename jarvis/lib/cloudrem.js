// Lembretes na nuvem (site na Vercel): guardados no Supabase e enviados pelo WhatsApp na hora, mesmo com o PC desligado.
// Precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (só no servidor; nunca no navegador) e da tabela abaixo. Quem dispara é
// GET /api/cron/lembretes com "Authorization: Bearer CRON_SECRET", chamado a cada minuto por um agendador (ex.: cron-job.org).
import * as whatsapp from './whatsapp.js';
import { registerSecret } from './secrets.js';

export const SQL = `create table if not exists public.jarvis_lembretes (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  numero text not null,
  texto text not null,
  quando timestamptz not null,
  enviado boolean not null default false,
  enviado_em timestamptz,
  erro text,
  criado timestamptz not null default now()
);
create index if not exists jarvis_lembretes_pend on public.jarvis_lembretes (enviado, quando);
alter table public.jarvis_lembretes enable row level security;`;

const TABLE = 'jarvis_lembretes';
const MAX_PEND = 50;
const cfg = () => {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (key) registerSecret(key);
  return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && key.length > 20 ? { url, key } : null;
};
export const on = () => !!cfg() && whatsapp.configured();
export const cronOk = req => { const s = String(process.env.CRON_SECRET || ''); return s.length >= 16 && String(req.headers.authorization || '') === `Bearer ${s}`; };
export const DB = { fetch: (...a) => fetch(...a) };   // trocável nos testes

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const c = cfg(); if (!c) throw Object.assign(new Error('Banco de lembretes não configurado.'), { code: 503 });
  const r = await DB.fetch(`${c.url}/rest/v1/${path}`, { method, signal: AbortSignal.timeout(10_000),
    headers: { apikey: c.key, authorization: `Bearer ${c.key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'A tabela de lembretes não existe no Supabase.' : `O banco de lembretes respondeu com erro (${r.status}).`), { code: 502 });
  return r.status === 204 ? null : r.json().catch(() => null);
}
const uidOk = u => /^[\w-]{1,80}$/.test(String(u || ''));

export async function add(uid, { texto, quando, numero }) {
  const n = whatsapp.normalize(numero), t = String(texto || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 300), at = Number(quando);
  if (!uidOk(uid) || !n || !t || !Number.isFinite(at)) throw Object.assign(new Error('Lembrete inválido.'), { code: 400 });
  if (at < Date.now() - 60_000 || at > Date.now() + 366 * 86400_000) throw Object.assign(new Error('Horário do lembrete fora do permitido.'), { code: 400 });
  const pend = await rest(`${TABLE}?select=id&uid=eq.${encodeURIComponent(uid)}&enviado=is.false&limit=${MAX_PEND}`);
  if ((pend || []).length >= MAX_PEND) throw Object.assign(new Error(`Limite de ${MAX_PEND} lembretes pendentes.`), { code: 429 });
  const [row] = await rest(TABLE, { method: 'POST', prefer: 'return=representation', body: { uid, numero: n, texto: t, quando: new Date(at).toISOString() } });
  return { id: row.id, quando: at };
}
export async function list(uid) {
  if (!uidOk(uid)) return [];
  const rows = await rest(`${TABLE}?select=id,texto,quando&uid=eq.${encodeURIComponent(uid)}&enviado=is.false&order=quando.asc&limit=${MAX_PEND}`);
  return (rows || []).map(r => ({ id: r.id, texto: r.texto, quando: Date.parse(r.quando) }));
}
export async function cancel(uid, id) {
  if (!uidOk(uid) || !/^[0-9a-f-]{36}$/i.test(String(id))) throw Object.assign(new Error('Lembrete inválido.'), { code: 400 });
  await rest(`${TABLE}?id=eq.${id}&uid=eq.${encodeURIComponent(uid)}&enviado=is.false`, { method: 'DELETE' });
}
// Dispara os vencidos. Cada um é "reservado" (enviado=false -> true) antes de sair: duas chamadas ao mesmo tempo não mandam em dobro.
export async function run(now = Date.now()) {
  const rows = await rest(`${TABLE}?select=id,numero,texto,quando&enviado=is.false&quando=lte.${encodeURIComponent(new Date(now).toISOString())}&order=quando.asc&limit=50`) || [];
  let sent = 0, failed = 0;
  for (const r of rows) {
    const claim = await rest(`${TABLE}?id=eq.${r.id}&enviado=is.false`, { method: 'PATCH', prefer: 'return=representation', body: { enviado: true, enviado_em: new Date(now).toISOString() } });
    if (!claim?.length) continue;
    if (now - Date.parse(r.quando) > 86400_000) { await rest(`${TABLE}?id=eq.${r.id}`, { method: 'PATCH', body: { erro: 'atrasado mais de um dia; não enviado' } }); continue; }
    try { await whatsapp.send(r.numero, `⏰ Lembrete do Jarvis: ${r.texto}`); sent++; }
    catch (e) { failed++; await rest(`${TABLE}?id=eq.${r.id}`, { method: 'PATCH', body: { erro: String(e.message || 'falhou').slice(0, 200) } }).catch(() => {}); }
  }
  return { vencidos: rows.length, enviados: sent, falhas: failed };
}
