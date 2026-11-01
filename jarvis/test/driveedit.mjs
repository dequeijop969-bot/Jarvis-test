// Drive (Google e IA simulados): pedidos de alteração viram operações de verdade (renomear, mover, criar pasta e documento,
// acrescentar e trocar texto); lixeira só com confirmação; sem a permissão de editar, avisa em vez de fingir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-drive-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'chave-gratis-0000000000', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret' });
for (const k of ['JARVIS_SITE_ONLY', 'GEMINI_API_KEY_PAGO']) delete process.env[k];

const FILES = [
  { id: 'arquivo00001', name: 'Relatório', mimeType: 'application/vnd.google-apps.document', modifiedTime: new Date().toISOString(), webViewLink: 'https://docs.google.com/d/1' },
  { id: 'pasta0000001', name: 'Projetos', mimeType: 'application/vnd.google-apps.folder', modifiedTime: new Date().toISOString(), webViewLink: 'https://drive.google.com/f/1' }];
const calls = [];
let nextOp = null;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const U = String(url), m = opt.method || 'GET';
  if (U.includes('generativelanguage.googleapis.com')) return J({ candidates: [{ content: { parts: [{ text: JSON.stringify(nextOp || { intro: 'ok', slides: [], outro: '' }) }] } }] });
  if (U.startsWith('https://www.googleapis.com/drive/v3/files') || U.startsWith('https://www.googleapis.com/upload/drive/v3/files') || U.startsWith('https://docs.googleapis.com/')) {
    calls.push({ m, U, body: opt.body && typeof opt.body === 'string' ? opt.body : opt.body ? '[bin]' : '' });
    if (U.startsWith('https://docs.googleapis.com/') && m === 'GET') return J({ body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } });
    if (U.includes(':batchUpdate')) return J({ replies: [{ replaceAllText: { occurrencesChanged: 2 } }] });
    if (U.includes('/files?') && m === 'GET') return J({ files: FILES });
    const id = (U.match(/files\/([\w-]+)/) || [])[1];
    if (m === 'GET' && id) return J({ parents: ['raiz'] });
    if (m === 'PATCH') { const f = FILES.find(x => x.id === id) || FILES[0]; const b = JSON.parse(opt.body || '{}'); return J({ ...f, ...(b.name ? { name: b.name } : {}) }); }
    if (m === 'POST') return J({ id: 'novo00000001', name: (String(opt.body).match(/"name":"([^"]+)"/) || [])[1] || 'novo', mimeType: 'x', webViewLink: 'https://drive.google.com/novo' });
  }
  return realFetch(url, opt);
};
const { setTokens } = await import('../lib/oauth.js');
const gd = await import('../lib/gdrive.js');
// O leitor: alteração vira "editar"; procurar continua "buscar"
assert.equal(gd.parse('renomeia o relatório no drive para relatório final').op, 'editar');
assert.equal(gd.parse('cria uma pasta Viagens no drive').op, 'editar');
assert.equal(gd.parse('procura o contrato no drive').op, 'buscar');
assert.equal(gd.parse('meus arquivos recentes do drive').op, 'recentes');
assert.equal(gd.parse('salva no drive').op, 'salvar');

const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const chat = async (text, op) => { nextOp = op; const r = await fetch(B + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ text }) }); return r.json(); };
const said = j => JSON.stringify(j);
try {
  await fetch(B + '/api/profile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ name: 'Lucca', address: 'senhor', city: { name: 'São Paulo', latitude: -23.5, longitude: -46.6, timezone: 'America/Sao_Paulo' } }) });
  // Só leitura (login antigo): avisa para reconectar, não finge
  setTokens('google', { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3, scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file' });
  let j = await chat('renomeia o relatório no drive para relatório final', { op: 'renomear', arquivo: 'relatório', nome: 'Relatório final' });
  assert.match(said(j), /reconecte o Google/); assert.ok(!calls.some(c => c.m === 'PATCH'));
  // Com a permissão de editar
  setTokens('google', { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3, scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents' });
  j = await chat('renomeia o relatório no drive para relatório final', { op: 'renomear', arquivo: 'relatório', nome: 'Relatório final' });
  assert.match(said(j), /Relatório agora se chama Relatório final/); assert.match(calls.at(-1).body, /"name":"Relatório final"/);
  j = await chat('move o relatório para a pasta projetos no drive', { op: 'mover', arquivo: 'relatório', pasta: 'projetos' });
  assert.match(said(j), /Movi Relatório para a pasta Projetos/); assert.match(calls.at(-1).U, /addParents=pasta0000001/);
  j = await chat('cria uma pasta Viagens no drive', { op: 'criar_pasta', nome: 'Viagens' });
  assert.match(said(j), /Criei a pasta Viagens/); assert.match(calls.at(-1).body, /vnd\.google-apps\.folder/);
  j = await chat('cria um documento lista de compras no drive com leite e pão', { op: 'criar_doc', nome: 'Lista de compras', texto: 'leite\npão' });
  assert.match(said(j), /Criei o documento Lista de compras/); assert.match(calls.at(-1).U, /upload\/drive\/v3/);
  j = await chat('escreve no relatório do drive: revisar segunda', { op: 'acrescentar', arquivo: 'relatório', texto: 'revisar segunda' });
  assert.match(said(j), /Escrevi no fim de Relatório/); assert.match(calls.at(-1).body, /insertText.*revisar segunda/);
  j = await chat('troca 2025 por 2026 no relatório do drive', { op: 'substituir', arquivo: 'relatório', de: '2025', para: '2026' });
  assert.match(said(j), /Troquei 2 ocorrências em Relatório/);
  // Lixeira: pede confirmação; só sai com "confirmo"
  const before = calls.filter(c => /"trashed":true/.test(c.body)).length;
  j = await chat('apaga o relatório do drive', { op: 'lixeira', arquivo: 'relatório' });
  assert.equal(j.action.kind, 'drive_trash'); assert.equal(calls.filter(c => /"trashed":true/.test(c.body)).length, before, 'nada antes de confirmar');
  j = await chat('confirmo', null);
  assert.match(said(j), /lixeira do Drive/); assert.equal(calls.filter(c => /"trashed":true/.test(c.body)).length, before + 1);
  console.log('drive: renomear, mover, criar pasta/documento, escrever e trocar texto, lixeira com confirmação e aviso sem permissão ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  fs.rmSync(DIR, { recursive: true, force: true });
}
process.exit(0);
