// Login com GitHub. A sessão vai num cookie CRIPTOGRAFADO (AES-256-GCM), sem banco e sem estado: funciona em funções serverless.
import crypto from 'node:crypto';
import { SESSION_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_SCOPE, BASE_URL } from './config.js';

// Sem JARVIS_SESSION_SECRET (uso local), usa um segredo aleatório do processo: a sessão some ao reiniciar. O modo hospedado EXIGE o segredo.
const SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const KEY = crypto.createHash('sha256').update('jarvis-session|' + SECRET).digest();
const DAYS = 14;

export function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
export function unseal(v) {
  try {
    const b = Buffer.from(String(v), 'base64url'); if (b.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}
const getCookie = (h, n) => { const m = new RegExp('(?:^|;\\s*)' + n + '=([^;]+)').exec(h || ''); return m ? m[1] : null; };
const flags = secure => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function readSession(header) {
  const s = unseal(getCookie(header, 'jv'));
  return s && typeof s.login === 'string' && s.exp > Date.now() ? s : null;
}
export const sessionCookie = (sess, secure) =>
  sess ? `jv=${seal({ ...sess, exp: sess.exp || Date.now() + DAYS * 864e5 })}; ${flags(secure)}; Max-Age=${DAYS * 86400}` : `jv=; ${flags(secure)}; Max-Age=0`;

// "state" do OAuth: protege contra login forjado (CSRF). Vale 10 minutos.
export function newState(secure) {
  const state = crypto.randomBytes(16).toString('hex');
  return { state, cookie: `jvs=${seal({ s: state, exp: Date.now() + 600_000 })}; ${flags(secure)}; Max-Age=600` };
}
export function checkState(header, state) {
  const v = unseal(getCookie(header, 'jvs'));
  return !!(v && v.exp > Date.now() && typeof state === 'string' && v.s.length === state.length && crypto.timingSafeEqual(Buffer.from(v.s), Buffer.from(state)));
}
export const clearStateCookie = secure => `jvs=; ${flags(secure)}; Max-Age=0`;

export const githubConfigured = () => !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
const REDIRECT = () => BASE_URL + '/auth/github/callback';
export const githubAuthUrl = state => 'https://github.com/login/oauth/authorize?' + new URLSearchParams({ client_id: GITHUB_CLIENT_ID, redirect_uri: REDIRECT(), scope: GITHUB_SCOPE, state, allow_signup: 'false' });

async function tokenCall(params) {
  const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'jarvis' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, ...params }), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || !j.access_token) throw new Error('O GitHub recusou o login.');
  // GitHub App: o token expira (~8 h) e vem com refresh_token. OAuth App: não expira.
  return { access: j.access_token, refresh: j.refresh_token || null, exp: j.expires_in ? Date.now() + j.expires_in * 1000 - 60_000 : null };
}
export const githubExchange = code => tokenCall({ code, redirect_uri: REDIRECT() });
export const githubRefresh = refresh => tokenCall({ grant_type: 'refresh_token', refresh_token: refresh });
export async function githubUser(token) {
  const r = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'jarvis' }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error('Não consegui ler o seu usuário do GitHub.');
  const u = await r.json();
  return { login: String(u.login), name: String(u.name || u.login) };
}
