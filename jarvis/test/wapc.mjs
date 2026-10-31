// Pedidos do WhatsApp para o PC (site simulado): o app aberto busca a fila, responde pelo próprio Jarvis e devolve a resposta.
// Mesmo com o perfil no 5.1 (chave paga), o que vem do WhatsApp sai pelo 2.5 (chave grátis).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wapc-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'chave-gratis-0000000000', GEMINI_API_KEY_PAGO: 'chave-PAGA-9999999999', JARVIS_CONTA_URL: 'https://site.exemplo' });
delete process.env.JARVIS_SITE_ONLY;
fs.writeFileSync(path.join(DIR, 'conta.json'), JSON.stringify({ token: 'passe-do-app-' + 'x'.repeat(40), user: { name: 'Lucca' }, waPc: true }));

const gem = [], respostas = [];
let fila = [{ id: '00000000-0000-4000-8000-000000000001', texto: 'me explica o que é um buraco negro' }];
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const U = String(url);
  if (U.includes('generativelanguage.googleapis.com')) { gem.push({ key: opt.headers?.['x-goog-api-key'], url: U }); return J({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intro: 'Um buraco negro é onde nem a luz escapa, senhor.', slides: [], outro: '' }) }] } }] }); }
  return realFetch(url, opt);
};
const conta = await import('../lib/conta.js');
conta.CONTA.fetch = async (url, opt = {}) => {
  const U = String(url);
  assert.equal(opt.headers.authorization, 'Bearer passe-do-app-' + 'x'.repeat(40));
  if (U === 'https://site.exemplo/api/nuvem/pc/fila') { const it = fila; fila = []; return J({ itens: it }); }
  if (U.startsWith('https://site.exemplo/api/nuvem/pc/fila/')) { respostas.push({ id: U.split('/').pop(), ...JSON.parse(opt.body) }); return J({ ok: true }); }
  return J({ error: 'não esperado: ' + U }, 404);
};
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
try {
  // perfil no 5.1 (a chave paga existe)
  let r = await fetch(B + '/api/profile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ name: 'Lucca', address: 'senhor', level: '5.1', city: { name: 'São Paulo', latitude: -23.5, longitude: -46.6, timezone: 'America/Sao_Paulo' } }) });
  assert.equal((await r.json()).profile.level, '5.1');
  // o app busca a fila a cada 15 s
  const t0 = Date.now();
  while (!respostas.length && Date.now() - t0 < 25_000) await new Promise(z => setTimeout(z, 500));
  assert.equal(respostas.length, 1, 'o app respondeu o pedido da fila');
  assert.equal(respostas[0].id, '00000000-0000-4000-8000-000000000001');
  assert.match(respostas[0].resposta, /^🖥️ Um buraco negro é onde nem a luz escapa/);
  assert.ok(gem.length >= 1 && gem.every(g => g.key === 'chave-gratis-0000000000' && /flash-lite/.test(g.url)), 'pelo WhatsApp: só a chave grátis (2.5)');
  // sem passe/ligação, o app não busca nada
  conta.logout();
  fila = [{ id: '00000000-0000-4000-8000-000000000002', texto: 'oi' }];
  await new Promise(z => setTimeout(z, 16_000));
  assert.equal(respostas.length, 1, 'sem conta, não busca');
  console.log('wapc: o app pega a fila do WhatsApp, responde pelo Jarvis no 2.5 e para sem conta ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
