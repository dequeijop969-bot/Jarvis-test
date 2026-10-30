// Site público (modo site) com contas no Supabase: cadastro com confirmação de e-mail, login, cookie assinado com a
// pessoa certa, dono continua entrando, erros do Supabase viram mensagens claras. O Supabase aqui é falso (fetch interceptado).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-supa-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const SB = 'https://abcdefghijklmnop.supabase.co';
Object.assign(process.env, {
  JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), JARVIS_SITE_ONLY: '1',
  JARVIS_SESSION_SECRET: 'x'.repeat(48), SUPABASE_URL: SB + '/', SUPABASE_ANON_KEY: 'anon-' + 'k'.repeat(40)
});
delete process.env.JARVIS_ALLOW_SIGNUP;

// Supabase falso: guarda contas na memória; "confirmado" só depois de confirm(email).
const accounts = new Map(), calls = [];
let down = false, googleOn = true, lastChallenge = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (!String(url).startsWith(SB)) return realFetch(url, opt);
  const u = new URL(url), b = JSON.parse(opt.body || '{}');
  calls.push({ path: u.pathname + u.search, apikey: opt.headers?.apikey, body: b });
  const json = (status, j) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  if (down) return json(503, { message: 'down' });
  if (u.pathname === '/auth/v1/signup') {
    const a = accounts.get(b.email);
    if (a?.confirmed) return json(200, { id: 'fake', email: b.email, identities: [] });
    if (b.password.length < 10) return json(422, { error_code: 'weak_password', msg: 'Password should be at least 10 characters.' });
    const id = a?.id || `00000000-0000-4000-8000-${String(accounts.size + 1).padStart(12, '0')}`;
    accounts.set(b.email, { id, password: b.password, name: b.data?.name, confirmed: false });
    return json(200, { id, email: b.email, identities: [{ id }], user_metadata: { name: b.data?.name }, confirmation_sent_at: new Date().toISOString() });
  }
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    const a = accounts.get(b.email);
    if (!a || a.password !== b.password) return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    if (!a.confirmed) return json(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
    return json(200, { access_token: 'at', user: { id: a.id, email: b.email, user_metadata: { name: a.name } } });
  }
  // Google: configurações públicas e a troca do código (PKCE) da volta do Google.
  if (u.pathname === '/auth/v1/settings') return json(200, { external: { email: true, google: googleOn } });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') {
    const want = (await import('node:crypto')).createHash('sha256').update(String(b.code_verifier)).digest('base64url');
    if (b.auth_code !== 'codigo-do-google-123' || want !== lastChallenge) return json(400, { error_code: 'bad_code_verifier', msg: 'invalid' });
    return json(200, { access_token: 'at', user: { id: '11111111-2222-4333-8444-555555555555', email: 'Bia@Gmail.com', user_metadata: { full_name: 'Bia Lima', name: 'Bia Lima' } } });
  }
  return json(404, {});
};

const { server } = await import('../server.js');
const users = await import('../lib/users.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const post = (p, body, cookie = '') => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1', origin: B, 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie = '') => fetch(B + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];

try {
  // A página sabe que o cadastro está aberto.
  assert.deepEqual(await (await get('/api/health')).json(), { ok: true, site: true, signup: true, web: false, google: true });

  // Cadastro: validação local antes de ir ao Supabase.
  assert.equal((await post('/api/auth/register', { name: 'Ana', email: 'ruim', password: '12345678' })).status, 400);
  assert.equal(calls.filter(c => c.path.includes('signup')).length, 0, 'e-mail inválido nem chega no Supabase');
  // Senha que o Supabase acha fraca: mensagem em português.
  let r = await post('/api/auth/register', { name: 'Ana', email: 'ana@exemplo.com', password: 'curta123' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Senha fraca/);
  // Cadastro certo: fica pendente (confirmação por e-mail), sem cookie.
  r = await post('/api/auth/register', { name: 'Ana Souza', email: 'Ana@Exemplo.com', password: 'senha-boa-123' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.pending, true); assert.match(j.message, /ana@exemplo\.com/);
  assert.equal(r.headers.get('set-cookie'), null, 'sem login antes de confirmar');
  assert.equal(calls.at(-1).apikey, process.env.SUPABASE_ANON_KEY);
  assert.equal(calls.at(-1).body.data.name, 'Ana Souza');

  // Antes de confirmar: aviso claro.
  r = await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'senha-boa-123' });
  assert.equal(r.status, 403); assert.match((await r.json()).error, /Confirme seu e-mail/);
  // Confirmou: entra, com cookie dela.
  accounts.get('ana@exemplo.com').confirmed = true;
  r = await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'senha-boa-123' });
  assert.equal(r.status, 200);
  const ana = cookieOf(r);
  assert.match(ana, /^jarvis_sid=/);
  assert.deepEqual((await (await get('/api/auth/me', ana)).json()).user, { id: 'sb_00000000-0000-4000-8000-000000000001', name: 'Ana Souza', email: 'ana@exemplo.com' });
  // Logada: a página de download abre e o download vai para o link configurado.
  assert.equal((await get('/baixar', ana)).status, 200);
  // Cookie adulterado (trocar quem é) não vale.
  const [name, val] = ana.split('='), [body, sig] = val.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'dono', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal((await (await get('/api/auth/me', `${name}=${forged}.${sig}`)).json()).user, null);
  assert.equal((await (await get('/api/auth/me', `${name}=${body}.${sig.slice(0, -2)}xx`)).json()).user, null);

  // Senha errada: 401 genérico. E-mail já confirmado: 409.
  assert.equal((await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'errada-123' })).status, 401);
  assert.equal((await post('/api/auth/register', { name: 'Ana', email: 'ana@exemplo.com', password: 'outra-senha-123' })).status, 409);

  // Supabase fora do ar: 503 com mensagem, e não conta como senha errada.
  down = true;
  r = await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'senha-boa-123' });
  assert.equal(r.status, 503); assert.match((await r.json()).error, /fora do ar|não respondeu/);
  down = false;

  // O dono continua entrando sem passar pelo Supabase.
  process.env.JARVIS_OWNER_EMAIL = 'dono@exemplo.com';
  process.env.JARVIS_OWNER_PASSWORD_HASH = await users.hashForSite('senha-do-dono-1');
  const before = calls.length;
  r = await post('/api/auth/login', { email: 'dono@exemplo.com', password: 'senha-do-dono-1' });
  assert.equal(r.status, 200); assert.equal(calls.length, before, 'dono não consulta o Supabase');
  assert.equal((await (await get('/api/auth/me', cookieOf(r))).json()).user.id, 'dono');
  // Ninguém cria conta com o e-mail do dono.
  assert.equal((await post('/api/auth/register', { name: 'Fake', email: 'dono@exemplo.com', password: 'senha-boa-123' })).status, 409);

  // Cadastro fechado (JARVIS_ALLOW_SIGNUP=0): 403 e a página esconde a aba.
  process.env.JARVIS_ALLOW_SIGNUP = '0';
  assert.equal((await post('/api/auth/register', { name: 'Bia', email: 'bia@exemplo.com', password: 'senha-boa-123' })).status, 403);
  assert.equal((await (await get('/api/health')).json()).signup, false);
  delete process.env.JARVIS_ALLOW_SIGNUP;

  // Entrar com o Google: ida para o Supabase com PKCE (o verificador fica num cookie assinado, nunca na URL)...
  r = await fetch(B + '/auth/entrar/google?next=/app', { redirect: 'manual', headers: { 'x-forwarded-host': 'jarvis.exemplo.app', 'x-forwarded-proto': 'https' } });
  assert.equal(r.status, 302);
  const go = new URL(r.headers.get('location'));
  assert.equal(go.origin + go.pathname, SB + '/auth/v1/authorize'); assert.equal(go.searchParams.get('provider'), 'google');
  assert.equal(go.searchParams.get('redirect_to'), 'https://jarvis.exemplo.app/auth/entrar/volta'); assert.equal(go.searchParams.get('code_challenge_method'), 's256');
  lastChallenge = go.searchParams.get('code_challenge');
  const pk = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.match(pk, /^jarvis_pkce=/); assert.match(r.headers.get('set-cookie'), /HttpOnly/); assert.ok(!go.search.includes(pk.split('=')[1].split('.')[0]), 'verificador fora da URL');
  // ... e volta: código + verificador viram a conta e a sessão de sempre; vai para onde a pessoa ia (/app).
  r = await get('/auth/entrar/volta?code=codigo-do-google-123', pk);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/app');
  const gk = (r.headers.get('set-cookie') || '').match(/jarvis_sid=[^;]+/)[0];
  assert.deepEqual((await (await get('/api/auth/me', gk)).json()).user, { id: 'sb_11111111-2222-4333-8444-555555555555', name: 'Bia Lima', email: 'bia@gmail.com' });
  assert.equal((await get('/baixar', gk)).status, 200);
  // Sem o cookie (outra máquina, ou expirou), código errado, ou o Google recusou: volta para o login com aviso.
  for (const [q, c] of [['?code=codigo-do-google-123', ''], ['?code=outro-codigo-qualquer', pk], ['?error=access_denied', pk], ['?code=codigo-do-google-123', pk.replace(/.$/, 'x')]])
    assert.equal((await get('/auth/entrar/volta' + q, c)).headers.get('location'), '/entrar?erro=google', q + ' ' + !!c);
  // "next" só para páginas nossas: nada de mandar para fora.
  r = await fetch(B + '/auth/entrar/google?next=https://evil.com', { redirect: 'manual' });
  lastChallenge = new URL(r.headers.get('location')).searchParams.get('code_challenge');
  r = await get('/auth/entrar/volta?code=codigo-do-google-123', (r.headers.get('set-cookie') || '').split(';')[0]);
  assert.equal(r.headers.get('location'), '/baixar');

  // Chave secreta colada por engano: recusada (só a pública serve).
  const anon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_ANON_KEY = 'sb_secret_' + 'z'.repeat(30); assert.equal(users.supa(), null);
  process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.sig'; assert.equal(users.supa(), null);
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_' + 'p'.repeat(30); assert.ok(users.supa());
  process.env.SUPABASE_ANON_KEY = anon;

  // URL que não é do Supabase: ignorada (não manda senha para qualquer lugar).
  process.env.SUPABASE_URL = 'https://evil.example.com';
  assert.equal(users.supa(), null);
  assert.equal((await post('/api/auth/register', { name: 'Bia', email: 'bia@exemplo.com', password: 'senha-boa-123' })).status, 403);

  console.log('supabase: cadastro com confirmação, login, Google (PKCE), cookie por pessoa, dono, erros e cadastro fechado ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
