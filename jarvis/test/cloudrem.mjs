// Lembretes na nuvem (Supabase e WhatsApp simulados): o app manda pelo passe, o site guarda, o agendador dispara uma vez só,
// cancelar apaga, e na web o lembrete vai para o número da pessoa. Sem o segredo do agendador, nada dispara.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-nuvem-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), JARVIS_SITE_ONLY: '1', JARVIS_SESSION_SECRET: 's'.repeat(48),
  GEMINI_API_KEY: 'fakeGeminiKey-web-0000', JARVIS_OWNER_EMAIL: 'dono@exemplo.com', JARVIS_OWNER_NAME: 'Lucca Dono',
  SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake-key-000000', CRON_SECRET: 'cron-segredo-1234567',
  WHATSAPP_TOKEN: 'EAAfake', WHATSAPP_PHONE_ID: '123456789012345' });
for (const k of ['SUPABASE_ANON_KEY', 'JARVIS_WEB_TRIAL', 'GOOGLE_CLIENT_ID', 'SPOTIFY_CLIENT_ID']) delete process.env[k];

// Supabase REST mínimo em memória (select/insert/patch/delete com filtros eq/is/lte)
const rows = [], wa = [];
let seq = 0;
const match = (r, q) => [...q.entries()].every(([k, v]) => {
  if (['select', 'order', 'limit'].includes(k)) return true;
  const [op, ...rest] = v.split('.'), val = rest.join('.');
  if (op === 'eq') return String(r[k]) === val;
  if (op === 'is') return String(r[k]) === val;
  if (op === 'lte') return Date.parse(r[k]) <= Date.parse(val);
  return true;
});
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const U = String(url);
  if (U.startsWith('https://graph.facebook.com/')) { wa.push(JSON.parse(opt.body)); return J({ messages: [{ id: 'w' + wa.length }] }); }
  if (U.startsWith('https://abcdefgh.supabase.co/rest/v1/jarvis_lembretes')) {
    assert.equal(opt.headers.apikey, 'service-role-fake-key-000000');
    const q = new URL(U).searchParams, m = opt.method || 'GET';
    if (m === 'POST') { const r = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, enviado: false, ...JSON.parse(opt.body) }; rows.push(r); return J([r], 201); }
    const hit = rows.filter(r => match(r, q));
    if (m === 'GET') return J(hit.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando)));
    if (m === 'PATCH') { const b = JSON.parse(opt.body); hit.forEach(r => Object.assign(r, b)); return J(hit); }
    if (m === 'DELETE') { hit.forEach(r => rows.splice(rows.indexOf(r), 1)); return new Response(null, { status: 204 }); }
  }
  if (U.includes('generativelanguage')) return J({ candidates: [{ content: { parts: [{ text: '{"intro":"ok","slides":[],"outro":""}' }] } }] });
  return realFetch(url, opt);
};

const users = await import('../lib/users.js');
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const call = (m, p, body, h = {}) => fetch(B + p, { method: m, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-jarvis': '1', ...h }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
  const pass = { authorization: 'Bearer ' + users.appToken({ id: 'sb_lucca', name: 'Lucca', email: 'l@exemplo.com' }) };
  // App do PC guarda um lembrete (passe obrigatório)
  assert.equal((await call('POST', '/api/nuvem/lembrete', { texto: 'x', quando: Date.now() + 60e3, numero: '11912345678' })).status, 401);
  let r = await call('POST', '/api/nuvem/lembrete', { texto: 'Pagar a conta', quando: Date.now() + 1000, numero: '11 91234-5678' }, pass);
  const { id } = await r.json(); assert.equal(r.status, 200); assert.equal(rows[0].numero, '5511912345678'); assert.equal(rows[0].uid, 'sb_lucca');
  assert.equal((await call('POST', '/api/nuvem/lembrete', { texto: 'velho', quando: Date.now() - 3600e3, numero: '11912345678' }, pass)).status, 400);
  // Agendador: sem o segredo, nada; com ele, ainda não venceu
  assert.equal((await call('GET', '/api/cron/lembretes')).status, 401);
  const cron = { authorization: 'Bearer cron-segredo-1234567' };
  assert.equal((await (await call('GET', '/api/cron/lembretes', null, cron)).json()).enviados, 0);
  await new Promise(z => setTimeout(z, 1100));
  // Venceu: duas chamadas ao mesmo tempo mandam uma vez só
  const [a, b] = await Promise.all([call('GET', '/api/cron/lembretes', null, cron), call('GET', '/api/cron/lembretes', null, cron)].map(p => p.then(x => x.json())));
  assert.equal(a.enviados + b.enviados, 1); assert.equal(wa.length, 1);
  assert.equal(wa[0].to, '5511912345678'); assert.equal(wa[0].text.body, '⏰ Lembrete do Jarvis: Pagar a conta');
  assert.equal((await (await call('GET', '/api/cron/lembretes', null, cron)).json()).enviados, 0, 'não repete');
  // Cancelar pelo app apaga (e só o dono do lembrete)
  r = await call('POST', '/api/nuvem/lembrete', { texto: 'Dentista', quando: Date.now() + 3600e3, numero: '11912345678' }, pass);
  const id2 = (await r.json()).id;
  const outro = { authorization: 'Bearer ' + users.appToken({ id: 'sb_outra', name: 'O', email: 'o@exemplo.com' }) };
  await call('DELETE', '/api/nuvem/lembrete/' + id2, null, outro); assert.ok(rows.find(x => x.id === id2), 'outra conta não apaga');
  await call('DELETE', '/api/nuvem/lembrete/' + id2, null, pass); assert.ok(!rows.find(x => x.id === id2));
  // Web: o lembrete vai para o número salvo no perfil da pessoa
  const ck = 'jarvis_sid=' + users.siteToken({ id: 'sb_web', name: 'Web', email: 'w@exemplo.com' });
  let j = await (await call('POST', '/api/chat', { text: 'me lembra de beber água às 23:59' }, { cookie: ck })).json();
  assert.match(JSON.stringify(j), /coloque o seu número/);
  const perfil = Buffer.from(JSON.stringify({ whatsapp: '21 99876-5432' })).toString('base64');
  j = await (await call('POST', '/api/chat', { text: 'me lembra de beber água às 23:59' }, { cookie: ck, 'x-jarvis-perfil': perfil })).json();
  assert.match(JSON.stringify(j), /Aviso no seu WhatsApp/); const w = rows.find(x => x.uid === 'sb_web');
  assert.equal(w.numero, '5521998765432'); assert.equal(w.texto, 'beber água');
  j = await (await call('POST', '/api/chat', { text: 'quais são meus lembretes' }, { cookie: ck, 'x-jarvis-perfil': perfil })).json();
  assert.match(JSON.stringify(j), /beber água/);
  j = await (await call('POST', '/api/chat', { text: 'cancela o lembrete de beber água' }, { cookie: ck, 'x-jarvis-perfil': perfil })).json();
  assert.match(JSON.stringify(j), /Cancelado/); assert.ok(!rows.find(x => x.uid === 'sb_web'));
  // Perfil da web aceita o número
  const pf = await (await call('POST', '/api/profile', { whatsapp: '(21) 99876-5432' }, { cookie: ck })).json();
  assert.equal(pf.profile.whatsapp, '21998765432');
  console.log('nuvem: lembretes pelo passe do app, agendador com segredo e sem duplicar, cancelar só do dono e lembretes da web ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
