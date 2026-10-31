// Jarvis no WhatsApp (Supabase, Meta e IA simulados): assinatura da Meta, ligar o número por código, conversar, lembrete no
// banco, áudio, fila do PC (o app pega e responde), lembrete escrito pela IA e só a chave grátis (nunca a paga).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wabot-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
const SECRET = 'app-secret-da-meta-123456';
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), JARVIS_SITE_ONLY: '1', JARVIS_SESSION_SECRET: 's'.repeat(48),
  GEMINI_API_KEY: 'chave-gratis-0000000000', GEMINI_API_KEY_PAGO: 'chave-PAGA-9999999999', JARVIS_OWNER_EMAIL: 'dono@exemplo.com',
  SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake-key-000000', CRON_SECRET: 'cron-segredo-1234567',
  WHATSAPP_TOKEN: 'EAAfake', WHATSAPP_PHONE_ID: '123456789012345', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verifica-jarvis' });
for (const k of ['SUPABASE_ANON_KEY', 'JARVIS_WEB_TRIAL', 'GOOGLE_CLIENT_ID', 'SPOTIFY_CLIENT_ID', 'WHATSAPP_TEMPLATE']) delete process.env[k];

// Supabase REST mínimo, várias tabelas
const T = {}, PK = { jarvis_wa_contas: 'numero', jarvis_wa_codigos: 'codigo', jarvis_wa_msgs: 'id', jarvis_pc_fila: 'id', jarvis_lembretes: 'id' };
let seq = 0;
const match = (r, q) => [...q.entries()].every(([k, v]) => {
  if (['select', 'order', 'limit'].includes(k)) return true;
  const [op, ...rest] = v.split('.'), val = rest.join('.');
  if (op === 'eq' || op === 'is') return String(r[k]) === val;
  if (op === 'lte') return Date.parse(r[k]) <= Date.parse(val);
  return true;
});
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const sent = [], gem = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const U = String(url), m = opt.method || 'GET';
  const sb = U.match(/^https:\/\/abcdefgh\.supabase\.co\/rest\/v1\/(\w+)/);
  if (sb) {
    const t = sb[1], rows = (T[t] ||= []), q = new URL(U).searchParams, pk = PK[t], pref = String(opt.headers?.prefer || '');
    if (m === 'POST') {
      const b = { ...JSON.parse(opt.body) }; if (pk === 'id' && !b.id) b.id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      if (t === 'jarvis_pc_fila') { b.estado ||= 'pendente'; b.criado ||= new Date().toISOString(); }
      if (t === 'jarvis_lembretes') b.enviado ??= false;
      const old = rows.find(r => r[pk] === b[pk]);
      if (old) { if (pref.includes('ignore-duplicates')) return J([]); if (pref.includes('merge-duplicates')) { Object.assign(old, b); return J([old], 201); } return J({ message: 'duplicate' }, 409); }
      rows.push(b); return J([b], 201);
    }
    const hit = rows.filter(r => match(r, q));
    if (m === 'GET') return J(hit);
    if (m === 'PATCH') { const b = JSON.parse(opt.body); hit.forEach(r => Object.assign(r, b)); return J(hit); }
    if (m === 'DELETE') { hit.forEach(r => rows.splice(rows.indexOf(r), 1)); return new Response(null, { status: 204 }); }
  }
  if (U.startsWith('https://graph.facebook.com/v21.0/123456789012345?')) return J({ display_phone_number: '+1 555-208-0975', verified_name: 'Jarvis' });
  if (U.startsWith('https://graph.facebook.com/v21.0/123456789012345/messages')) { const b = JSON.parse(opt.body); sent.push({ to: b.to, text: b.text?.body }); return J({ messages: [{ id: 'w' + sent.length }] }); }
  if (U === 'https://graph.facebook.com/v21.0/midia-1') return J({ url: 'https://lookaside.fbsbx.com/audio-1', mime_type: 'audio/ogg; codecs=opus', file_size: 900 });
  if (U === 'https://lookaside.fbsbx.com/audio-1') return new Response(Buffer.from('OggS-fake-audio'), { status: 200 });
  if (U.includes('generativelanguage.googleapis.com')) {
    const key = opt.headers?.['x-goog-api-key'], body = JSON.parse(opt.body), sys = body.systemInstruction?.parts?.[0]?.text || '';
    gem.push({ key, url: U, sys });
    const txt = /lembrete para WhatsApp/.test(sys) ? { texto: 'Senhor, são horas de pagar a conta. Recomendo não testar a paciência do banco.' }
      : /Transcreva/.test(sys) ? { texto: 'oi jarvis, tudo bem?' } : { intro: 'Às suas ordens, senhor.', slides: [], outro: '' };
    return J({ candidates: [{ content: { parts: [{ text: JSON.stringify(txt) }] } }] });
  }
  return realFetch(url, opt);
};

const users = await import('../lib/users.js');
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const call = (m, p, body, h = {}) => fetch(B + p, { method: m, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-jarvis': '1', ...h }, ...(body ? { body: JSON.stringify(body) } : {}) });
let mid = 0;
const hook = async (from, msg, sig = true) => {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456789012345' }, contacts: [{ wa_id: from, profile: { name: 'Lucca' } }], messages: [{ id: 'wamid.' + (++mid), from, ...msg }] } }] }] });
  const s = 'sha256=' + crypto.createHmac('sha256', sig === true ? SECRET : 'outro-segredo-qualquer').update(raw).digest('hex');
  return fetch(B + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': s }, body: raw });
};
const lastTo = n => sent.filter(x => x.to === n).at(-1)?.text || '';
const EU = '5511900000001';
try {
  // Meta confere o endereço
  let r = await call('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verifica-jarvis&hub.challenge=abc123');
  assert.equal(r.status, 200); assert.equal(await r.text(), 'abc123');
  assert.equal((await call('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x')).status, 403);
  // Assinatura obrigatória
  assert.equal((await hook(EU, { type: 'text', text: { body: 'oi' } }, false)).status, 401);
  assert.equal(sent.length, 0);
  // Número desconhecido: explica como ligar
  r = await hook(EU, { type: 'text', text: { body: 'oi' } }); assert.equal(r.status, 200);
  assert.match(lastTo(EU), /ligue este número à sua conta/);
  // Na web, a pessoa gera o código e manda "JARVIS 123456"
  const ck = 'jarvis_sid=' + users.siteToken({ id: 'sb_lucca', name: 'Lucca', email: 'l@exemplo.com' });
  const perfil = Buffer.from(JSON.stringify({ address: 'senhor', about: { trabalho: 'dev' } })).toString('base64');
  const v = await (await call('POST', '/api/whatsapp/vincular', {}, { cookie: ck, 'x-jarvis-perfil': perfil })).json();
  assert.match(v.codigo, /^\d{6}$/); assert.equal(v.numero, '15552080975'); assert.equal(v.link, `https://wa.me/15552080975?text=JARVIS%20${v.codigo}`);
  await hook(EU, { type: 'text', text: { body: 'JARVIS 000000' } }); assert.match(lastTo(EU), /código não vale/);
  await hook(EU, { type: 'text', text: { body: `JARVIS ${v.codigo}` } }); assert.match(lastTo(EU), /Este número agora fala comigo/);
  assert.equal(T.jarvis_wa_contas[0].uid, 'sb_lucca'); assert.equal(T.jarvis_wa_contas[0].pc, false);
  assert.equal((await (await call('GET', '/api/whatsapp/vinculo', null, { cookie: ck })).json()).numero, '•••• 0001');
  // Conversa com a IA (só a chave grátis) e a mesma mensagem reenviada pela Meta não responde duas vezes
  const n0 = sent.length, raw = { type: 'text', text: { body: 'me conta uma curiosidade' } };
  await hook(EU, raw); assert.equal(lastTo(EU), 'Às suas ordens, senhor.');
  const dupId = 'wamid.' + mid; const again = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456789012345' }, messages: [{ id: dupId, from: EU, ...raw }] } }] }] });
  await fetch(B + '/api/whatsapp/webhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(again).digest('hex') }, body: again });
  assert.equal(sent.length, n0 + 1, 'mensagem repetida não responde de novo');
  assert.equal(T.jarvis_wa_contas[0].historico.length, 2);
  // Lembrete: vai para o banco com o próprio número
  await hook(EU, { type: 'text', text: { body: 'me lembra de pagar a conta às 23:59' } });
  assert.match(lastTo(EU), /Aviso no seu WhatsApp/); assert.equal(T.jarvis_lembretes[0].numero, EU);
  // Áudio: transcreve e responde
  await hook(EU, { type: 'audio', audio: { id: 'midia-1' } }); assert.equal(lastTo(EU), 'Às suas ordens, senhor.');
  // Coisa do PC sem o PC ligado à conta
  await hook(EU, { type: 'text', text: { body: 'abre o spotify' } }); assert.match(lastTo(EU), /coisa do seu PC/);
  // Pelo app (passe): religa o número com PC liberado e logins do Google deste PC
  const pass = { authorization: 'Bearer ' + users.appToken({ id: 'sb_lucca', name: 'Lucca', email: 'l@exemplo.com' }) };
  const v2 = await (await call('POST', '/api/nuvem/whatsapp', { perfil: { name: 'Lucca', address: 'senhor' }, tokens: { google: { access_token: 'a', refresh_token: 'r', expires_at: 0, scope: 's' }, lixo: 1 } }, pass)).json();
  await hook(EU, { type: 'text', text: { body: `jarvis ${v2.codigo}` } }); assert.match(lastTo(EU), /coisas no seu PC/);
  assert.equal(T.jarvis_wa_contas.length, 1); assert.equal(T.jarvis_wa_contas[0].pc, true); assert.ok(T.jarvis_wa_contas[0].tokens && !T.jarvis_wa_contas[0].tokens.includes('refresh'), 'login cifrado');
  // Pedido do PC vai para a fila; o app pega e responde; a resposta chega no WhatsApp
  await hook(EU, { type: 'text', text: { body: 'abre o spotify' } }); assert.match(lastTo(EU), /Mandei para o seu PC/);
  assert.equal((await (await call('GET', '/api/nuvem/pc/fila', null, { authorization: 'Bearer ' + users.appToken({ id: 'sb_outra' }) })).json()).itens.length, 0, 'outra conta não vê');
  const fila = (await (await call('GET', '/api/nuvem/pc/fila', null, pass)).json()).itens;
  assert.equal(fila.length, 1); assert.equal(fila[0].texto, 'abre o spotify');
  assert.equal((await (await call('GET', '/api/nuvem/pc/fila', null, pass)).json()).itens.length, 0, 'não pega duas vezes');
  await call('POST', '/api/nuvem/pc/fila/' + fila[0].id, { resposta: '🖥️ Abrindo o Spotify, senhor.' }, pass);
  assert.equal(lastTo(EU), '🖥️ Abrindo o Spotify, senhor.');
  // Agendador: lembrete vencido sai escrito pela IA; pedido do PC esquecido avisa
  T.jarvis_lembretes[0].quando = new Date(Date.now() - 1000).toISOString();
  T.jarvis_pc_fila.push({ id: '00000000-0000-4000-8000-999999999999', uid: 'sb_lucca', numero: EU, texto: 'desliga o pc', estado: 'pendente', criado: new Date(Date.now() - 5 * 60_000).toISOString() });
  const cron = await (await call('GET', '/api/cron/lembretes', null, { authorization: 'Bearer cron-segredo-1234567' })).json();
  assert.equal(cron.enviados, 1);
  assert.ok(sent.some(x => x.to === EU && x.text === '⏰ Senhor, são horas de pagar a conta. Recomendo não testar a paciência do banco.'), 'lembrete escrito pela IA');
  assert.match(lastTo(EU), /Seu PC não respondeu em 3 minutos/);
  // Só a chave grátis, sempre no nível 2.5
  assert.ok(gem.length >= 3); assert.ok(gem.every(g => g.key === 'chave-gratis-0000000000'), 'nunca a chave paga'); assert.ok(gem.every(g => /flash-lite/.test(g.url)), 'sempre o 2.5');
  // Desligar
  await hook(EU, { type: 'text', text: { body: 'desligar Jarvis' } }); assert.match(lastTo(EU), /Desligado/); assert.equal(T.jarvis_wa_contas.length, 0);
  console.log('wabot: assinatura, ligação por código, conversa, lembrete, áudio, fila do PC, lembrete pela IA e só a chave grátis ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
