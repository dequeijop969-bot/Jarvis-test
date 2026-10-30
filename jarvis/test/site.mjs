// Site: contas (scrypt + sessão por cookie), páginas protegidas, download do app e o que NUNCA entra no ZIP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-site-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT) });
const { server } = await import('../server.js');
const pkg = await import('../lib/package.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const post = (p, body, cookie = '') => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie = '') => fetch(B + p, { redirect: 'manual', headers: cookie ? { cookie } : {} });

try {
  // Páginas públicas.
  for (const p of ['/', '/entrar', '/guia', '/site3d.js']) assert.equal((await get(p)).status, 200, p);
  assert.match((await get('/')).headers.get('content-security-policy'), /cdnjs\.cloudflare\.com/);
  // Protegidas: sem login, vão para o login.
  for (const p of ['/baixar', '/download/jarvis-windows.zip']) { const r = await get(p); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/entrar?next=/baixar'); }

  // Cadastro: validações e senha nunca gravada em texto.
  assert.equal((await post('/api/auth/register', { name: 'A', email: 'a@b.co', password: '12345678' })).status, 400);
  assert.equal((await post('/api/auth/register', { name: 'Ana', email: 'nao-e-email', password: '12345678' })).status, 400);
  assert.equal((await post('/api/auth/register', { name: 'Ana', email: 'ana@exemplo.com', password: 'curta' })).status, 400);
  assert.equal((await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'sem o cabeçalho próprio (CSRF)');
  let r = await post('/api/auth/register', { name: 'Ana Souza', email: 'Ana@Exemplo.com', password: 'cavalo-bateria-9', next: 'https://evil.com' });
  assert.equal(r.status, 200);
  let j = await r.json(); assert.equal(j.user.email, 'ana@exemplo.com'); assert.equal(j.next, '/baixar', 'next externo vira /baixar');
  const ck = r.headers.get('set-cookie'); assert.match(ck, /jarvis_sid=[\w-]{20,}; HttpOnly; SameSite=Lax/);
  const cookie = ck.split(';')[0];
  const raw = fs.readFileSync(path.join(DIR, 'users.json'), 'utf8');
  assert.ok(!raw.includes('cavalo-bateria-9')); assert.match(raw, /"hash": "[a-f0-9]{128}"/);
  assert.ok(!fs.readFileSync(path.join(DIR, 'sessions.json'), 'utf8').includes(cookie.split('=')[1]), 'só o hash do token no disco');
  assert.equal((await post('/api/auth/register', { name: 'Outra', email: 'ana@exemplo.com', password: 'outra-senha-1' })).status, 409);

  // Logado: página de download e o ZIP.
  assert.deepEqual((await (await get('/api/auth/me', cookie)).json()).user, { id: j.user.id, name: 'Ana Souza', email: 'ana@exemplo.com' });
  assert.equal((await get('/baixar', cookie)).status, 200);
  assert.equal((await get('/entrar?next=/app', cookie)).headers.get('location'), '/app', 'já logado: segue para onde ia');
  r = await get('/download/jarvis-windows.zip', cookie);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip'); assert.match(r.headers.get('content-disposition'), /jarvis-windows\.zip/);
  const zipBuf = Buffer.from(await r.arrayBuffer()); assert.equal(zipBuf.subarray(0, 2).toString(), 'PK');

  // Sair: o cookie deixa de valer.
  await post('/api/auth/logout', {}, cookie);
  assert.equal((await (await get('/api/auth/me', cookie)).json()).user, null);
  // Login: senha errada não diz se o e-mail existe; 5 erros seguidos travam.
  r = await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'errada-000' }); assert.equal(r.status, 401);
  const msg = (await r.json()).error;
  assert.equal((await (await post('/api/auth/login', { email: 'ninguem@exemplo.com', password: 'x' })).json()).error, msg);
  assert.equal((await post('/api/auth/login', { email: 'ANA@exemplo.com', password: 'cavalo-bateria-9' })).status, 200);
  for (let i = 0; i < 5; i++) await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'errada' });
  assert.equal((await post('/api/auth/login', { email: 'ana@exemplo.com', password: 'cavalo-bateria-9' })).status, 429, 'travado por excesso de tentativas');

  // O ZIP: só o que está na allowlist. Nada de dados, chaves, .env, logs ou o perfil do navegador.
  const names = [];
  for (let i = 0; i < zipBuf.length - 46; i++) if (zipBuf.readUInt32LE(i) === 0x02014b50) names.push(zipBuf.subarray(i + 46, i + 46 + zipBuf.readUInt16LE(i + 28)).toString('utf8'));
  assert.ok(names.includes('Jarvis/LEIA-ME.txt') && names.includes('Jarvis/jarvis/server.js') && names.includes('Jarvis/jarvis/.env.example'));
  const leak = names.filter(n => /\/data\/|data-demo|\/\.env$|keys\.local|tokens\.local|\/profile\.json|\/memory\.json|users\.json|sessions\.json|navegador-flutuante|\/logs\/|\.log$|amostras-voz|mascote\/config\.json/.test(n));
  assert.deepEqual(leak, []);
  assert.ok(pkg.fileList().every(f => !f.rel.startsWith('jarvis/data')));
  // Instalador: o instalador base + o ZIP + onde o ZIP começa + "JARVISZ1" (se o JarvisSetup.exe estiver compilado).
  const inst = pkg.buildInstaller();
  if (inst) {
    assert.equal(inst.subarray(inst.length - 8).toString('ascii'), 'JARVISZ1');
    const start = Number(inst.readBigInt64LE(inst.length - 16));
    assert.equal(inst.subarray(start, start + 2).toString(), 'PK'); assert.equal(inst.subarray(0, 2).toString(), 'MZ');
    assert.equal((await get('/download/JarvisSetup.exe')).status, 302, 'sem login: vai para o login');
  }
  console.log('site: páginas, contas, sessão, download e pacote ok');
} finally { server.close(); }
