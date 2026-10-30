// App do PC com a conta do site: "Entrar" abre o site, a pessoa confirma, o passe volta para o app (localhost), e a IA
// passa a responder pela chave do servidor. O site confere o passe e o modelo; sair desliga. Dois servidores de verdade:
// o "site" num processo separado (modo site, Gemini falso) e o app aqui.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conta-site-')), APP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conta-app-'));
const SP = 3000 + Math.floor(Math.random() * 400) + 50, LP = SP + 450;
const S = `http://localhost:${SP}`, L = `http://localhost:${LP}`;

// O app: sem chave de IA nenhuma, apontando para o "site" abaixo. (Antes de importar qualquer módulo: a porta é lida na hora.)
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: APP_DIR, PORT: String(LP), JARVIS_CONTA_URL: S });
for (const k of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_PAGO', 'ANTHROPIC_API_KEY', 'JARVIS_SITE_ONLY']) delete process.env[k];
const users = await import('../lib/users.js');
const site = spawn(process.execPath, ['--import', './test/gemini-fake.mjs', 'server.js'], { cwd: path.join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, JARVIS_SITE_ONLY: '1', JARVIS_DATA_DIR: SITE_DIR, PORT: String(SP), JARVIS_SESSION_SECRET: 'z'.repeat(48), GEMINI_API_KEY: 'chave-do-servidor-123',
    JARVIS_OWNER_EMAIL: 'dono@exemplo.com', JARVIS_OWNER_NAME: 'Lucca', JARVIS_OWNER_PASSWORD_HASH: await users.hashForSite('senha-do-dono-1'), JARVIS_NO_LISTEN: '' } });
let siteLog = ''; site.stdout.on('data', d => siteLog += d); site.stderr.on('data', d => siteLog += d);

const { server } = await import('../server.js');
await new Promise(r => server.listen(LP, '127.0.0.1', r));
for (let i = 0; i < 60; i++) { try { if ((await fetch(S + '/api/health')).ok) break; } catch { } await new Promise(r => setTimeout(r, 150)); }
const get = (u, cookie = '', headers = {}) => fetch(u, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } });
const post = (u, body, headers = {}) => fetch(u, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'x-jarvis': '1', ...headers }, body: JSON.stringify(body) });

try {
  await post(L + '/api/profile', { name: 'Lucca', address: 'senhor', city: { name: 'Jundiaí', latitude: -23.18, longitude: -46.89, timezone: 'America/Sao_Paulo' }, lang: 'pt-BR' });
  let st = await (await get(L + '/api/state')).json();
  assert.equal(st.integrations.conta.on, false);
  // Sem chave e sem conta: a IA não responde.
  let r = await post(L + '/api/chat', { text: 'oi' });
  assert.notEqual(r.status, 200);

  // 1) Entrar: o app manda para o site com um "state" e a porta dele.
  r = await get(L + '/auth/conta');
  const go = new URL(r.headers.get('location'));
  assert.equal(go.origin, S); assert.equal(go.pathname, '/conectar-app'); assert.equal(go.searchParams.get('porta'), String(LP));
  // Sem login no site: vai para o login, e volta para a conexão depois.
  r = await get(go.href);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/entrar?next=' + encodeURIComponent(go.pathname + go.search));
  r = await post(S + '/api/auth/login', { email: 'dono@exemplo.com', password: 'senha-do-dono-1', next: go.pathname + go.search });
  const sj = await r.json(), ck = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.equal(sj.next, go.pathname + go.search, 'o login devolve para a conexão do app');
  // 2) Confirma: a página mostra quem vai conectar; o "ok" manda o passe para o app NESTE computador.
  r = await get(go.href, ck); assert.equal(r.status, 200); assert.match(await r.text(), /Conectar este computador\?[\s\S]*Lucca/);
  r = await get(S + '/conectar-app/ok' + go.search, ck);
  const back = new URL(r.headers.get('location'));
  assert.equal(back.origin, `http://localhost:${LP}`); assert.equal(back.pathname, '/auth/conta/volta');
  // Porta ou state inválidos: recusado (o passe nunca vai para outro lugar).
  assert.equal((await get(S + '/conectar-app/ok?state=' + go.searchParams.get('state') + '&porta=80', ck)).status, 400);
  // Passe de volta com "state" que este app não abriu: recusado.
  r = await get(L + '/auth/conta/volta?state=AAAAAAAAAAAAAAAAAAAAAAAA&token=' + back.searchParams.get('token'));
  assert.match(r.headers.get('location'), /conta=erro/);
  // 3) Volta certa: conectado.
  r = await get(back.href);
  assert.equal(r.headers.get('location'), '/app?conta=ok');
  st = await (await get(L + '/api/state')).json();
  assert.deepEqual([st.integrations.conta.on, st.integrations.conta.name, st.integrations.conta.email], [true, 'Lucca', 'dono@exemplo.com']);
  assert.ok(!JSON.stringify(st).includes(back.searchParams.get('token')), 'o passe não vai para a página');
  // O mesmo state não vale duas vezes.
  assert.match((await get(back.href)).headers.get('location'), /conta=erro/);

  // 4) A IA agora responde pela chave do servidor (só o Flash Lite / Flash).
  r = await post(L + '/api/chat', { text: 'qual a capital da França?' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.match(j.intro, /via servidor gemini-3\.5-flash-lite chave ok: qual a capital da França/);
  // O site recusa: sem passe, passe falso, modelo fora da lista (o Argon).
  const tok = back.searchParams.get('token'), req = { contents: [{ role: 'user', parts: [{ text: 'oi' }] }] };
  assert.equal((await post(S + '/api/nuvem/gemini', { model: 'gemini-3.5-flash-lite', request: req })).status, 401);
  assert.equal((await post(S + '/api/nuvem/gemini', { model: 'gemini-3.5-flash-lite', request: req }, { authorization: 'Bearer ' + tok.slice(0, -3) + 'abc' })).status, 401);
  assert.equal((await post(S + '/api/nuvem/gemini', { model: 'gemini-4-argon', request: req }, { authorization: 'Bearer ' + tok })).status, 403);
  // O cookie de sessão do site não serve como passe do app (e vice-versa).
  assert.equal((await post(S + '/api/nuvem/gemini', { model: 'gemini-3.5-flash-lite', request: req }, { authorization: 'Bearer ' + ck.split('=')[1] })).status, 401);
  assert.equal((await (await get(S + '/api/auth/me', 'jarvis_sid=' + tok)).json()).user, null);
  // O passe fica guardado só no PC (data/conta.json), nunca na conversa nem nos logs do app.
  assert.ok(fs.readFileSync(path.join(APP_DIR, 'conta.json'), 'utf8').includes(tok));

  // 5) Sair: desliga, e a IA volta a não ter como responder.
  st = await (await post(L + '/api/conta/sair', {})).json();
  assert.equal(st.conta.on, false);
  assert.notEqual((await post(L + '/api/chat', { text: 'oi de novo' })).status, 200);
  console.log('conta: entrar pelo site, passe só para este PC, IA pela chave do servidor, recusas e sair ok');
} catch (e) { console.error(siteLog.slice(-1500)); throw e; }
finally {
  server.close(); site.kill();
  for (const d of [SITE_DIR, APP_DIR]) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(0);
