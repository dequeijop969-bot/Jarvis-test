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
  // No site público, contas só com o Supabase (sem ele, o disco da Vercel não guarda nada).
  if (SITE() && !signupOpen()) throw err(403, 'Cadastro fechado por enquanto. Entre com a conta do dono.');
  const n = String(name || '').replace(/[\x00-\x1f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60), e = normEmail(email), pw = String(password || '');
  if (n.length < 2) throw err(400, 'Diga seu nome.');
  if (!EMAIL.test(e)) throw err(400, 'Esse e-mail não parece válido.');
  if (pw.length < 8) throw err(400, 'A senha precisa de pelo menos 8 caracteres.');
  if (pw.length > 200) throw err(400, 'Senha longa demais.');
  if (pw.toLowerCase() === e || pw.toLowerCase() === n.toLowerCase()) throw err(400, 'Use uma senha diferente do seu nome e do e-mail.');
  if (SITE()) { if (e === owner().email) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.'); return supaRegister(n, e, pw); }
  const db = loadUsers();
  if (db.users.some(u => u.email === e)) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.');
  if (db.users.length >= 500) throw err(429, 'Limite de contas atingido.');
  const { salt, hash } = await hashPassword(pw);
  // Confere de novo depois do scrypt (que é assíncrono): dois cadastros iguais ao mesmo tempo passavam os dois pela
  // checagem lá de cima e criavam contas duplicadas com o mesmo e-mail.
  if (db.users.some(u => u.email === e)) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.');
  if (db.users.length >= 500) throw err(429, 'Limite de contas atingido.');
  const u = { id: crypto.randomBytes(8).toString('hex'), name: n, email: e, salt, hash, at: new Date().toISOString() };
  db.users.push(u); saveUsers();
  return publicUser(u);
}

const fails = new Map();   // email -> [instantes dos erros]; '*' = todos
function tooMany(e) {
  const now = Date.now(), recent = k => (fails.get(k) || []).filter(t => now - t < LOCK_WINDOW);
  return recent(e).length >= MAX_PER_EMAIL || recent('*').length >= MAX_GLOBAL;
}
function fail(e) {
  const now = Date.now();
  // Cada e-mail errado diferente virava uma entrada para sempre (o mapa só crescia). Passou de 5 mil: tira as vencidas.
  if (fails.size > 5000) for (const [k, v] of fails) if (k !== '*' && !v.some(t => now - t < LOCK_WINDOW)) fails.delete(k);
  for (const k of [e, '*']) fails.set(k, [...(fails.get(k) || []).filter(t => now - t < LOCK_WINDOW), now].slice(-60));
}

export async function login({ email, password }) {
  if (SITE()) return siteLogin({ email, password, _ip: arguments[0]?._ip });
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

export function createSession(user) {
  if (SITE()) return siteToken(user);
  const userId = typeof user === 'object' && user ? user.id : user;
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
  if (SITE()) return siteUser(req);
  const t = cookieOf(req);
  if (!t) return null;
  const s = loadSessions().sessions[sha(t)];
  if (!s || s.exp < Date.now()) return null;
  const u = loadUsers().users.find(x => x.id === s.user);
  return u ? publicUser(u) : null;
}
export function destroySession(req) {
  if (SITE()) return;   // cookie assinado: sair = apagar o cookie
  const t = cookieOf(req);
  if (t && loadSessions().sessions[sha(t)]) { delete sessions.sessions[sha(t)]; saveSessions(); }
}

/* ---------- Modo site (Vercel) ----------
   Na Vercel cada acesso pode cair num servidor novo e o disco não guarda nada: a sessão vira um cookie ASSINADO
   (HMAC com JARVIS_SESSION_SECRET) e, até o banco de dados (Supabase) chegar, só a conta do dono entra:
   JARVIS_OWNER_EMAIL + JARVIS_OWNER_PASSWORD_HASH ("sal:hash" do scrypt, gerado por jarvis/tools/senha-site.mjs).
   Com SUPABASE_URL + SUPABASE_ANON_KEY, cada pessoa cria a própria conta (JARVIS_ALLOW_SIGNUP=0 fecha o cadastro). */
export const SITE = () => process.env.JARVIS_SITE_ONLY === '1';
const secret = () => { const s = process.env.JARVIS_SESSION_SECRET || ''; if (s.length < 32) throw err(500, 'Falta configurar JARVIS_SESSION_SECRET no servidor.'); return s; };
const owner = () => ({ id: 'dono', name: (process.env.JARVIS_OWNER_NAME || 'Dono').slice(0, 60), email: normEmail(process.env.JARVIS_OWNER_EMAIL) });
// No site público, os erros contam por quem tenta (IP), não por e-mail nem no total: senão qualquer um travaria o login do
// dono só errando a senha de propósito (com o e-mail dele, ou com 30 e-mails quaisquer).
const tooManyIp = ip => { const now = Date.now(); return (fails.get(ip) || []).filter(t => now - t < LOCK_WINDOW).length >= MAX_PER_EMAIL; };
function failIp(ip) { const now = Date.now(); if (fails.size > 5000) for (const [k, v] of fails) if (!v.some(t => now - t < LOCK_WINDOW)) fails.delete(k);
  fails.set(ip, [...(fails.get(ip) || []).filter(t => now - t < LOCK_WINDOW), now].slice(-60)); }
export async function siteLogin({ email, password, _ip }) {
  const e = normEmail(email), ipKey = `ip:${String(_ip || '?').slice(0, 64)}`;
  if (tooManyIp(ipKey)) throw err(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
  const [salt, want] = String(process.env.JARVIS_OWNER_PASSWORD_HASH || '').split(':');
  const o = owner();
  const { hash } = await hashPassword(String(password || ''), salt || 'x'.repeat(32));
  const ok = !!(o.email && salt && want && want.length === hash.length && e === o.email && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(want, 'hex')));
  if (ok) { fails.delete(ipKey); return publicUser(o); }
  // Não é o dono: com o Supabase configurado, cada pessoa entra com a própria conta.
  if (supa()) {
    try { const u = await supaLogin(e, password); fails.delete(ipKey); return u; }
    catch (x) { if (x.code === 401) failIp(ipKey); throw x; }
  }
  failIp(ipKey); throw err(401, 'E-mail ou senha incorretos.');
}

/* ---------- Supabase (contas de cada pessoa no site) ----------
   Só a parte de login do Supabase (Auth), pela API REST: nenhuma tabela, nenhuma dependência. Precisa de SUPABASE_URL e
   SUPABASE_ANON_KEY (a chave "anon"/"publishable", feita para ficar no navegador; a "service_role" NUNCA vai aqui).
   O Supabase confere a senha; depois disso a sessão é o mesmo cookie assinado do dono, com id, nome e e-mail dentro. */
export const supa = () => {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = String(process.env.SUPABASE_ANON_KEY || '').trim();
  // Nunca a chave secreta: "service_role"/"sb_secret_" daria acesso total ao projeto se vazasse.
  if (key.startsWith('sb_secret_') || /service_role/.test(key.startsWith('eyJ') ? Buffer.from(key.split('.')[1] || '', 'base64url').toString() : '')) return null;
  return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && key.length > 20 ? { url, key } : null;
};
export const signupOpen = () => !!supa() && process.env.JARVIS_ALLOW_SIGNUP !== '0';
async function supaCall(pathAndQuery, body) {
  const s = supa();
  let r;
  try {
    // Chave nova ("sb_publishable_...") vai só em apikey; a antiga ("anon", um JWT) também vai como Bearer.
    const headers = { apikey: s.key, 'content-type': 'application/json', ...(s.key.startsWith('eyJ') ? { authorization: `Bearer ${s.key}` } : {}) };
    r = await fetch(s.url + pathAndQuery, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  } catch { throw err(503, 'O serviço de contas não respondeu. Tente de novo em instantes.'); }
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, msg: String(j.error_code || j.code || '') + ' ' + String(j.msg || j.message || j.error_description || j.error || '') };
}
const supaUser = u => ({ id: 'sb_' + String(u?.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40), name: String(u?.user_metadata?.name || u?.email?.split('@')[0] || 'Você').replace(/[\x00-\x1f<>]/g, '').slice(0, 60), email: normEmail(u?.email) });
async function supaLogin(e, password) {
  const { status, j, msg } = await supaCall('/auth/v1/token?grant_type=password', { email: e, password: String(password || '') });
  if (status === 200 && j.user?.id) return supaUser(j.user);
  if (/not.?confirmed/i.test(msg)) throw err(403, 'Confirme seu e-mail primeiro: o link chegou na sua caixa de entrada (olhe o spam também).');
  if (status === 429) throw err(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
  if (status >= 500) throw err(503, 'O serviço de contas está fora do ar. Tente de novo em instantes.');
  throw err(401, 'E-mail ou senha incorretos.');
}
// Cadastro no Supabase. Com "Confirm email" ligado (o padrão), a conta só vale depois do link: devolve pending.
async function supaRegister(n, e, pw) {
  const { status, j, msg } = await supaCall('/auth/v1/signup', { email: e, password: pw, data: { name: n } });
  if (status === 200 || status === 201) {
    const u = j.user || j;
    // E-mail já cadastrado e confirmado: o Supabase responde 200 com identities vazio (para não entregar quem tem conta).
    if (Array.isArray(u.identities) && !u.identities.length) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.');
    if (j.access_token && u.id) return supaUser(u);
    return { pending: true, message: `Conta criada. Mandei um link de confirmação para ${e}; abra-o e depois entre aqui.` };
  }
  if (/already|exists|registered/i.test(msg)) throw err(409, 'Já existe uma conta com esse e-mail. Entre com ela.');
  if (/weak|password/i.test(msg)) throw err(400, 'Senha fraca demais: misture letras, números e símbolos.');
  if (/signup.*disabled|not allowed/i.test(msg)) throw err(403, 'Cadastro fechado por enquanto.');
  if (status === 429) throw err(429, 'Muitos cadastros em pouco tempo. Espere alguns minutos.');
  throw err(status >= 500 ? 503 : 400, 'Não consegui criar a conta agora. Tente de novo em instantes.');
}

/* ---------- Entrar com o Google (pelo Supabase) ----------
   O Supabase fala com o Google; aqui só começa e termina o caminho, no fluxo PKCE: o "verificador" fica num cookie
   assinado e curto (10 min) e nunca passa pela URL. Na volta, o código + o verificador viram a conta, e a sessão é a
   mesma de sempre (cookie assinado). Liga sozinho quando o provedor Google está ativo no Supabase. */
const PKCE = 'jarvis_pkce';
const sign = body => `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`;
function unsign(v) {
  const [body, sig] = String(v || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}
let googleCache = { at: 0, on: false };
// O Google está ligado no Supabase? (consulta as configurações públicas, guardada por 1 min)
export async function googleOn() {
  const s = supa();
  if (!s || process.env.JARVIS_GOOGLE_LOGIN === '0') return false;
  if (Date.now() - googleCache.at < 60_000) return googleCache.on;   // 1 min: ligou no Supabase, aparece logo
  try {
    const r = await fetch(`${s.url}/auth/v1/settings`, { headers: { apikey: s.key }, signal: AbortSignal.timeout(5000) });
    googleCache = { at: Date.now(), on: r.ok && (await r.json()).external?.google === true };
  } catch { googleCache = { at: Date.now() - 45_000, on: false }; }   // falhou: tenta de novo em 15 s
  return googleCache.on;
}
export function googleStart(origin, next) {
  const s = supa();
  if (!s) throw err(404, 'Login com o Google não configurado.');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const cookie = sign(Buffer.from(JSON.stringify({ v: verifier, n: next, exp: Date.now() + 10 * 60_000 })).toString('base64url'));
  const q = new URLSearchParams({ provider: 'google', redirect_to: `${origin}/auth/entrar/volta`, code_challenge: challenge, code_challenge_method: 's256' });
  return { url: `${s.url}/auth/v1/authorize?${q}`, cookie: `${PKCE}=${cookie}; HttpOnly; SameSite=Lax; Path=/auth/entrar; Max-Age=600${SITE() ? '; Secure' : ''}` };
}
export const pkceOf = req => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${PKCE}=([A-Za-z0-9_.-]{20,600})`)) || [])[1] || null;
export const clearPkce = () => `${PKCE}=; HttpOnly; SameSite=Lax; Path=/auth/entrar; Max-Age=0`;
// Volta do Google: troca o código pela conta. Devolve { user, next }.
export async function googleFinish(code, pkceCookie) {
  const st = unsign(pkceCookie);
  if (!st || !(st.exp > Date.now()) || typeof st.v !== 'string') throw err(400, 'O login com o Google expirou. Tente de novo.');
  if (typeof code !== 'string' || !/^[\w-]{8,200}$/.test(code)) throw err(400, 'O Google não devolveu o código de acesso.');
  const { status, j } = await supaCall('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: st.v });
  if (status !== 200 || !j.user?.id) throw err(status >= 500 ? 503 : 401, 'Não consegui entrar com o Google. Tente de novo.');
  const u = supaUser(j.user);
  if (!u.name || u.name === 'Você') u.name = String(j.user.user_metadata?.full_name || j.user.user_metadata?.name || '').slice(0, 60) || u.name;
  return { user: u, next: st.n };
}

export function siteToken(user) {
  const u = typeof user === 'object' && user ? user : { id: user };
  const d = u.id === 'dono' ? { u: 'dono' } : { u: u.id, n: u.name, e: u.email };
  const body = Buffer.from(JSON.stringify({ ...d, exp: Date.now() + SESSION_TTL })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function siteUser(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{10,800}\\.[A-Za-z0-9_-]{40,60})`));
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  let good; try { good = crypto.createHmac('sha256', secret()).update(body).digest('base64url'); } catch { return null; }
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!(d.exp > Date.now())) return null;
    if (d.u === 'dono') return publicUser(owner());
    return typeof d.u === 'string' && d.u.startsWith('sb_') ? { id: d.u, name: String(d.n || ''), email: String(d.e || '') } : null;
  } catch { return null; }
}
export async function hashForSite(password) { const { salt, hash } = await hashPassword(password); return `${salt}:${hash}`; }

export const setCookie = token => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${SITE() ? '; Secure' : ''}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
export const _reset = () => { users = null; sessions = null; fails.clear(); };
