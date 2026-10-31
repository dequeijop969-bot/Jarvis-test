// WhatsApp (Cloud API da Meta, simulada): frases, contatos, confirmação antes de enviar, janela de 24 h com modelo,
// erros traduzidos e lembretes no número do dono. Nada sai sem "confirmo" ou toque em Enviar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wa-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), WHATSAPP_TOKEN: 'EAAfake-whatsapp-token-0000', WHATSAPP_PHONE_ID: '123456789012345' });
for (const k of ['JARVIS_SITE_ONLY', 'WHATSAPP_TEMPLATE', 'WHATSAPP_MEU_NUMERO']) delete process.env[k];

const sent = [];
let mode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const U = String(url);
  if (!U.startsWith('https://graph.facebook.com/')) return realFetch(url, opt);
  assert.equal(opt.headers?.authorization, 'Bearer EAAfake-whatsapp-token-0000');
  if (!opt.method) return new Response(JSON.stringify({ display_phone_number: '+1 555 0100', verified_name: 'Jarvis' }), { status: 200 });
  const b = JSON.parse(opt.body); sent.push(b);
  if (mode === 'janela' && b.type === 'text') return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 });
  if (mode === 'teste') return new Response(JSON.stringify({ error: { code: 131030, message: 'Recipient not in allowed list' } }), { status: 400 });
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.' + sent.length }] }), { status: 200 });
};

const wa = await import('../lib/whatsapp.js');
// Frases
assert.deepEqual(wa.parse('manda no zap pro João que chego às 8'), { to: 'João', text: 'Chego às 8' });
assert.deepEqual(wa.parse('envia uma mensagem no WhatsApp para a Ana dizendo bom dia'), { to: 'Ana', text: 'Bom dia' });
assert.deepEqual(wa.parse('manda mensagem pra minha mãe no whatsapp: estou saindo'), { to: 'minha mãe', text: 'Estou saindo' });
assert.equal(wa.parse('abre o whatsapp'), null);
assert.equal(wa.parse('manda um email pro joão que chego às 8'), null, 'sem WhatsApp/zap na frase');
// Números
assert.equal(wa.normalize('(11) 91234-5678'), '5511912345678');
assert.equal(wa.normalize('+1 415 555 0100'), '14155550100', 'DDI de fora não vira +55');
assert.equal(wa.normalize('1234'), '');
assert.equal(wa.br9('551187654321'), '5511987654321', 'celular do Brasil sem o 9 ganha o 9');
assert.equal(wa.br9('551133334444'), '551133334444', 'fixo não muda');
assert.equal(wa.br9('5511987654321'), '5511987654321');
// Contatos
wa.addContact('João Silva', '11 91234-5678'); wa.addContact('Mãe', '21 99876-5432');
assert.throws(() => wa.addContact('X', '123'), /Número inválido/);
assert.equal(wa.resolve('João').numero, '5511912345678');
assert.equal(wa.resolve('minha mãe').nome, 'Mãe');
assert.equal(wa.resolve('11 98888-7777').numero, '5511988887777');
assert.equal(wa.resolve('Fulano'), null);

const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const call = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { s: r.status, j: await r.json().catch(() => null) }; };
try {
  await call('POST', '/api/profile', { name: 'Lucca', address: 'senhor', city: { name: 'São Paulo', latitude: -23.5, longitude: -46.6, timezone: 'America/Sao_Paulo' } });
  let r = await call('GET', '/api/integrations');
  assert.equal(r.j.whatsapp.state, 'on'); assert.equal(r.j.whatsapp.contatos.length, 2);
  assert.ok(!JSON.stringify(r.j).includes('EAAfake'), 'token nunca vai para a página');
  // Pedido: cria a ação e NÃO envia
  r = await call('POST', '/api/chat', { text: 'manda no zap pro João que chego às 8' });
  assert.equal(r.j.action.kind, 'whatsapp_send'); assert.equal(r.j.action.params.to, '5511912345678'); assert.equal(sent.length, 0, 'nada sai sem confirmar');
  // Confirmar por voz envia
  r = await call('POST', '/api/chat', { text: 'confirmo' });
  assert.match(r.j.slides?.[0]?.narration || r.j.intro || JSON.stringify(r.j), /Enviado para João Silva/);
  assert.deepEqual(sent.at(-1), { messaging_product: 'whatsapp', to: '5511912345678', type: 'text', text: { body: 'Chego às 8', preview_url: false } });
  // Cancelar não envia
  await call('POST', '/api/chat', { text: 'manda no zap pra mãe que já saí' });
  const n = sent.length; await call('POST', '/api/chat', { text: 'cancela' }); assert.equal(sent.length, n);
  // Contato desconhecido
  r = await call('POST', '/api/chat', { text: 'manda no zap pro Fulano que oi' });
  assert.match(JSON.stringify(r.j), /Não achei \\"Fulano\\"/); assert.ok(!r.j.action);
  // Fora da janela de 24 h: sem modelo, erro claro; com modelo, vai pelo modelo
  mode = 'janela';
  await assert.rejects(wa.send('5511912345678', 'oi'), /últimas 24 horas/);
  process.env.WHATSAPP_TEMPLATE = 'recado_jarvis';
  assert.equal((await wa.send('5511912345678', 'oi')).via, 'modelo');
  assert.equal(sent.at(-1).template.name, 'recado_jarvis'); assert.equal(sent.at(-1).template.components[0].parameters[0].text, 'oi');
  mode = 'teste';
  await assert.rejects(wa.send('5511912345678', 'oi'), /lista de teste/);
  mode = 'ok';
  // Teste da chave e remoção de contato
  r = await call('POST', '/api/whatsapp/teste', {}); assert.equal(r.j.nome, 'Jarvis');
  r = await call('DELETE', '/api/whatsapp/contatos/0'); assert.equal(r.j.whatsapp.contatos.length, 1);
  assert.equal((await call('POST', '/api/whatsapp/contatos', { nome: 'Y', numero: 'abc' })).s, 400);
  // Lembrete também no WhatsApp do dono
  process.env.WHATSAPP_MEU_NUMERO = '11 97777-6666';
  assert.equal(wa.myNumber(), '5511977776666');
  console.log('whatsapp: frases, contatos, confirmação antes de enviar, janela de 24 h com modelo, erros e lembretes ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
