// Gmail SOMENTE LEITURA (escopo gmail.readonly). Nada é enviado, apagado, arquivado ou alterado.
import { startFlow, finishFlow, getTokens, setTokens } from './oauth.js';
import { PORT, DEMO, BASE_URL } from './config.js';
import { log } from './secrets.js';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'; // só para mover à lixeira (confira na documentação)
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const CAL_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'; // só para criar compromissos, depois de confirmação
const CAL_API = 'https://www.googleapis.com/calendar/v3';
export const grantedScopes = () => String(getTokens('google')?.scope || '').split(' ').filter(Boolean);
export const canTrash = () => grantedScopes().includes(MODIFY_SCOPE);
export const canCalendar = () => grantedScopes().includes(CAL_SCOPE);
export const canCalendarWrite = () => grantedScopes().includes(CAL_WRITE_SCOPE);
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const cfg = () => ({
  id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirect: process.env.GOOGLE_REDIRECT_URI || `${BASE_URL}/auth/google/callback`
});
export const googleConfigured = () => DEMO || !!(cfg().id && cfg().secret);
let lastError = null;

export function googleStatus() {
  const t = getTokens('google');
  if (!googleConfigured()) return { state: 'off', configured: false, message: 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env.' };
  if (lastError && !t) return { state: 'error', configured: true, message: lastError };
  if (!t) return { state: 'off', configured: true, message: 'Não conectado.' };
  return { state: lastError ? 'error' : 'on', configured: true, message: lastError || (canTrash() ? 'Conectado: lê e move para a lixeira sob pedido.' : 'Conectado, somente leitura. Reautorize para habilitar lixeira e agenda.'), email: t.email || null, trash: canTrash(), calendar: canCalendar(), calendarWrite: canCalendarWrite() };
}

export function authRedirect() {
  const c = cfg(), { state, challenge } = startFlow('google');
  if (DEMO) return `/auth/google/callback?state=${state}&code=demo`;
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope: `${MODIFY_SCOPE} ${CAL_SCOPE} ${CAL_WRITE_SCOPE}`, include_granted_scopes: 'true',
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  return u.toString();
}

export async function handleCallback(q) {
  const verifier = finishFlow('google', q.get('state'));
  if (!verifier) throw new Error('Sessão de login inválida ou expirada. Tente de novo.');
  if (q.get('error')) throw new Error('Acesso ao Gmail não autorizado.');
  if (DEMO) { setTokens('google', { access_token: 'demo-access-token', refresh_token: 'demo-refresh-token', expires_at: Date.now() + 3600e3, scope: GMAIL_SCOPE, email: 'voce@exemplo.com' }); lastError = null; return; }
  const c = cfg();
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ code: q.get('code') || '', client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, grant_type: 'authorization_code', code_verifier: verifier })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('O Google recusou o login.');
  const scopes = String(j.scope || '').split(' ');
  if (!scopes.includes(GMAIL_SCOPE) && !scopes.includes(MODIFY_SCOPE)) throw new Error('A permissão de leitura do Gmail não foi concedida.');
  setTokens('google', { access_token: j.access_token, refresh_token: j.refresh_token || getTokens('google')?.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, scope: j.scope });
  lastError = null;
  try { const p = await gget('/profile'); const t = getTokens('google'); setTokens('google', { ...t, email: p.emailAddress || null }); } catch { /* opcional */ }
}

async function accessToken() {
  const t = getTokens('google');
  if (!t) throw Object.assign(new Error('Gmail desconectado.'), { code: 409 });
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  if (!t.refresh_token) { setTokens('google', null); lastError = 'Login do Gmail expirou. Conecte de novo.'; throw Object.assign(new Error(lastError), { code: 409 }); }
  const c = cfg();
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') { setTokens('google', null); lastError = 'O login do Gmail expirou (em modo de teste dura cerca de 7 dias). Conecte de novo.'; }
    else lastError = 'Não consegui renovar o acesso ao Gmail.';
    throw Object.assign(new Error(lastError), { code: 409 });
  }
  setTokens('google', { ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  return j.access_token;
}

async function gget(p) {
  const tok = await accessToken();
  const r = await fetch(API + p, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401) { lastError = 'O Gmail recusou o acesso. Conecte de novo.'; throw Object.assign(new Error(lastError), { code: 409 }); }
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Cota do Gmail estourada. Tente depois.' : 'O Gmail não respondeu agora.'), { code: 502 });
  lastError = null;
  return r.json();
}

export async function disconnect() {
  const t = getTokens('google');
  setTokens('google', null); lastError = null;
  if (t && !DEMO) {
    try { await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token || t.access_token }), signal: AbortSignal.timeout(8000) }); }
    catch { log.warn('[gmail] não consegui revogar no Google; os tokens locais foram apagados.'); }
  }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = s => String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10) || 32) : (ENT[e.toLowerCase()] ?? m));

export function parseFrom(v) {
  const s = String(v || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : s).trim().toLowerCase();
  const name = (m ? m[1] : '').trim() || email.split('@')[0];
  const domain = (email.split('@')[1] || '').replace(/[^a-z0-9.-]/g, '');
  return { name: name.slice(0, 60), email: email.slice(0, 120), domain };
}
export function parseAuth(v) {
  const s = String(v || '').toLowerCase();
  const pick = k => (s.match(new RegExp(`\\b${k}=(\\w+)`)) || [])[1] || 'none';
  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}

// Busca não lidos recentes: só metadados (remetente, assunto, data, snippet, Authentication-Results).
export async function listUnread({ q = 'is:unread newer_than:2d', max = 50 } = {}) {
  const list = await gget(`/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
  const ids = (list.messages || []).map(m => m.id).slice(0, max);
  const out = [];
  const meta = ['From', 'Subject', 'Date', 'Authentication-Results'].map(h => `metadataHeaders=${h}`).join('&');
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(id => gget(`/messages/${encodeURIComponent(id)}?format=metadata&${meta}`).catch(() => null)));
    for (const m of batch) {
      if (!m) continue;
      const H = n => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
      const f = parseFrom(H('From'));
      out.push({ id: m.id, from_name: f.name, from_email: f.email, from_domain: f.domain, subject: decodeEntities(H('Subject')).slice(0, 200) || '(sem assunto)',
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : H('Date'), snippet: decodeEntities(m.snippet).slice(0, 300), auth: parseAuth(H('Authentication-Results')) });
    }
  }
  return { emails: out, more: !!list.nextPageToken };
}

// Texto do corpo, só quando o usuário pede "abrir esse". Nunca é guardado.
export async function messageText(id) {
  const m = await gget(`/messages/${encodeURIComponent(id)}?format=full`);
  const parts = [];
  const walk = p => { if (!p) return; if (p.mimeType === 'text/plain' && p.body?.data) parts.push(Buffer.from(p.body.data, 'base64url').toString('utf8')); (p.parts || []).forEach(walk); };
  walk(m.payload);
  if (!parts.length) { const html = []; const w2 = p => { if (!p) return; if (p.mimeType === 'text/html' && p.body?.data) html.push(Buffer.from(p.body.data, 'base64url').toString('utf8')); (p.parts || []).forEach(w2); }; w2(m.payload); parts.push(html.join('\n').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')); }
  return decodeEntities(parts.join('\n')).replace(/\s+/g, ' ').trim().slice(0, 4000);
}

// Agenda: SOMENTE LEITURA (GET).
export async function calendarGet(p) {
  if (!canCalendar()) throw Object.assign(new Error('Agenda não autorizada. Reautorize o Google nas Integrações.'), { code: 409 });
  const tok = await accessToken();
  const r = await fetch(CAL_API + p, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(10000) });
  if (r.status === 401) { lastError = 'O Google recusou o acesso à agenda. Conecte de novo.'; throw Object.assign(new Error(lastError), { code: 409 }); }
  if (!r.ok) throw Object.assign(new Error(r.status === 429 ? 'Cota da agenda estourada. Tente depois.' : 'A agenda não respondeu agora.'), { code: 502 });
  return r.json();
}

// Lixeira: ÚNICAS escritas permitidas no Gmail. Não existe (e não deve existir) função de exclusão permanente.
async function gpost(p) {
  const tok = await accessToken();
  const r = await fetch(API + p, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-length': '0' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error('O Gmail não aceitou a operação.'), { code: 502 });
  return r.json();
}
const okId = id => /^[A-Za-z0-9_-]{6,64}$/.test(String(id));
export async function trashMessages(ids) {
  if (!canTrash()) throw Object.assign(new Error('Reautorize o Google para habilitar a lixeira.'), { code: 409 });
  const list = [...new Set((ids || []).map(String))].filter(okId);
  if (!list.length || list.length > 25) throw Object.assign(new Error('Máximo de 25 e-mails por ação.'), { code: 400 });
  if (DEMO) return { moved: list, skipped: [] };
  const moved = [], skipped = [];
  for (const id of list) {
    const m = await gget(`/messages/${encodeURIComponent(id)}?format=minimal`).catch(() => null);
    if (!m || (m.labelIds || []).includes('STARRED') || (m.labelIds || []).includes('TRASH')) { skipped.push(id); continue; }
    await gpost(`/messages/${encodeURIComponent(id)}/trash`); moved.push(id);
  }
  return { moved, skipped };
}
export async function untrashMessages(ids) {
  if (!canTrash()) throw Object.assign(new Error('Reautorize o Google para habilitar a lixeira.'), { code: 409 });
  const list = [...new Set((ids || []).map(String))].filter(okId).slice(0, 25);
  if (!DEMO) for (const id of list) await gpost(`/messages/${encodeURIComponent(id)}/untrash`);
  return { restored: list };
}

// Agenda: ÚNICA escrita permitida é CRIAR um evento na agenda principal (depois da confirmação). Não existe editar nem apagar.
export async function createCalendarEvent({ title, start, end, tz }) {
  if (!canCalendarWrite()) throw Object.assign(new Error('Preciso de permissão para criar compromissos. Reautorize o Google em Integrações.'), { code: 409 });
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Object.assign(new Error('Horário inválido.'), { code: 400 });
  if (DEMO) return { id: 'demo-event', link: null, title, start, end };
  const tok = await accessToken();
  const r = await fetch(`${CAL_API}/calendars/primary/events`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: String(title).slice(0, 120), start: { dateTime: new Date(start).toISOString(), timeZone: tz }, end: { dateTime: new Date(end).toISOString(), timeZone: tz }, description: 'Criado pelo JARVIS a pedido do dono da agenda.' })
  });
  if (r.status === 401 || r.status === 403) { lastError = 'O Google recusou criar o compromisso. Reautorize em Integrações.'; throw Object.assign(new Error(lastError), { code: 409 }); }
  if (!r.ok) throw Object.assign(new Error('O Google Agenda não aceitou o compromisso.'), { code: 502 });
  const j = await r.json().catch(() => ({}));
  return { id: String(j.id || ''), link: /^https:\/\//.test(j.htmlLink || '') ? j.htmlLink : null, title, start, end };
}
