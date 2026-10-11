// Contas do site (tela de login → página de download). Ficam em data/users.json e data/sessions.json, fora do git.
// Senha: scrypt com sal próprio (nunca gravada em texto). Sessão: token aleatório num cookie HttpOnly; no disco só o hash dele.
// Erro de login nunca diz se o e-mail existe. 5 erros seguidos no mesmo e-mail (ou 30 no total) em 10 min: espera 10 min.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { readJSON, writeJSON } from './store.js';

const scrypt = promisify(crypto.scrypt);
const USERS = 'users.json', SESSIONS = 'sessions.json';
export const COOKIE = 'jarvis_sid';
export const SESSION_TTL = 30 * 24 * 3600_000;   // 30 dias
const LOCK_WINDOW = 10 * 60_000, MAX_PER_EMAIL = 5, MAX_GLOBAL = 30;

const err = (code, message) => Object.assign(new Error(message), { code });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const normEmail = e => String(e || '').trim().toLowerCase();
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

let users = null, sessions = null;
const loadUsers = () => (users ??= readJSON(USERS, { users: [] }));
const loadSessions = () => (sessions ??= readJSON(SESSIONS, { sessions: {} }));
const saveUsers = () => writeJSON(USERS, users);
const saveSessions = () => writeJSON(SESSIONS, sessions);

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(String(password).normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt, hash: key.toString('hex') };
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

export async function register({ name, email, password }) {
  const n = String(name || '').replace(/[\x00-\x1f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60), e = normEmail(email), pw = String(password || '');
  if (n.length < 2) throw err(400, 'Diga seu nome.');
  if (!EMAIL.test(e)) throw err(400, 'Esse e-mail não parece válido.');
  if (pw.length < 8) throw err(400, 'A senha precisa de pelo menos 8 caracteres.');
  if (pw.length > 200) throw err(400, 'Senha longa demais.');
  if (pw.toLowerCase() === e || pw.toLowerCase() === n.toLowerCase()) throw err(400, 'Use uma senha diferente do seu nome e do e-mail.');
  const db = loadUsers();
  if (db.users.some(u => u.email === e)) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.');
  if (db.users.length >= 500) throw err(429, 'Limite de contas atingido.');
  const { salt, hash } = await hashPassword(pw);
  const u = { id: crypto.randomBytes(8).toString('hex'), name: n, email: e, salt, hash, at: new Date().toISOString() };
  db.users.push(u); saveUsers();
  return publicUser(u);
}

const fails = new Map();   // email -> [instantes dos erros]; '*' = todos
function tooMany(e) {
  const now = Date.now(), recent = k => (fails.get(k) || []).filter(t => now - t < LOCK_WINDOW);
  return recent(e).length >= MAX_PER_EMAIL || recent('*').length >= MAX_GLOBAL;
}
function fail(e) { const now = Date.now(); for (const k of [e, '*']) fails.set(k, [...(fails.get(k) || []).filter(t => now - t < LOCK_WINDOW), now].slice(-60)); }

export async function login({ email, password }) {
  const e = normEmail(email);
  if (tooMany(e)) throw err(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
  const u = loadUsers().users.find(x => x.email === e);
  // Sem conta: calcula um hash do mesmo jeito (o tempo de resposta não entrega se o e-mail existe).
  const { hash } = await hashPassword(String(password || ''), u?.salt || 'x'.repeat(32));
  const ok = u && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) { fail(e); throw err(401, 'E-mail ou senha incorretos.'); }
  fails.delete(e);
  return publicUser(u);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url'), s = loadSessions(), now = Date.now();
  for (const [k, v] of Object.entries(s.sessions)) if (v.exp < now) delete s.sessions[k];
  s.sessions[sha(token)] = { user: userId, exp: now + SESSION_TTL };
  saveSessions();
  return token;
}

export function cookieOf(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,80})`));
  return m ? m[1] : null;
}
export function userFromReq(req) {
  const t = cookieOf(req);
  if (!t) return null;
  const s = loadSessions().sessions[sha(t)];
  if (!s || s.exp < Date.now()) return null;
  const u = loadUsers().users.find(x => x.id === s.user);
  return u ? publicUser(u) : null;
}
export function destroySession(req) {
  const t = cookieOf(req);
  if (t && loadSessions().sessions[sha(t)]) { delete sessions.sessions[sha(t)]; saveSessions(); }
}

export const setCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
export const _reset = () => { users = null; sessions = null; fails.clear(); };
