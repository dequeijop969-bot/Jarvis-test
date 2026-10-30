// Segunda chave do Gemini: tarefas técnicas começam nela; sem cota numa chave, o pedido passa na hora para a outra.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-key2-'));
Object.assign(process.env, { JARVIS_DATA_DIR: DIR, GEMINI_API_KEY: 'chave-um-123456789', GEMINI_API_KEY_2: 'chave-dois-987654321' });
delete process.env.ANTHROPIC_API_KEY;
const { loadModels } = await import('../lib/models.js');
const { generate, ROUTER } = await import('../lib/router.js');
ROUTER.baseDelay = 1;
const models = loadModels();
assert.ok(models.levels.tech?.ok, 'nível técnico configurado');
assert.equal(models.levels.tech.primary.provider, 'gemini2');

const seen = []; let quota1 = false;
globalThis.fetch = async (url, o) => {
  const key = o.headers['x-goog-api-key'], model = String(url).match(/models\/([^:]+)/)[1];
  seen.push(`${key === 'chave-um-123456789' ? 1 : 2}:${model}`);
  if (key === 'chave-um-123456789' && quota1) return new Response('{}', { status: 429 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const ask = level => generate(models, level, { system: 's', messages: [{ role: 'user', content: 'oi' }], validate: x => x });

// Técnico: começa na chave 2.
let r = await ask('tech'); assert.equal(r.meta.provider, 'gemini2'); assert.deepEqual(seen, ['2:gemini-3.5-flash-lite']);
// Resposta normal: chave 1.
seen.length = 0; r = await ask('2.5'); assert.equal(r.meta.provider, 'gemini'); assert.deepEqual(seen, ['1:gemini-3.5-flash-lite']);
// Chave 1 sem cota: vai direto para a chave 2, com o MESMO modelo (sem esperar nem piorar o modelo).
seen.length = 0; quota1 = true; r = await ask('2.5');
assert.equal(r.meta.provider, 'gemini2'); assert.equal(r.meta.model, 'gemini-3.5-flash-lite'); assert.deepEqual(seen, ['1:gemini-3.5-flash-lite', '2:gemini-3.5-flash-lite']);
// Em pausa por cota: o próximo pedido nem tenta a chave 1.
seen.length = 0; await ask('2.5'); assert.deepEqual(seen, ['2:gemini-3.5-flash-lite']);
// Modelo sobrecarregado no Google (503) nas duas chaves: pula para o outro modelo, e o próximo pedido já vai direto nele.
const { clearBusy } = await import('../lib/router.js'); clearBusy(); quota1 = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => /flash-lite/.test(url) ? (seen.push('ocupado'), new Response('{}', { status: 503 })) : realFetch(url, o);
seen.length = 0; r = await ask('2.5'); assert.equal(r.meta.model, 'gemini-3.8-flash');
assert.ok(seen.filter(x => x === 'ocupado').length <= 2, 'não insiste no modelo ocupado nas duas chaves');
seen.length = 0; r = await ask('tech'); assert.equal(r.meta.model, 'gemini-3.8-flash'); assert.ok(!seen.includes('ocupado'), 'em pausa: nem tenta');
globalThis.fetch = realFetch; clearBusy();
// Sem a chave 2: tudo segue na chave 1.
delete process.env.GEMINI_API_KEY_2;
const { getKey } = await import('../lib/keys.js'); assert.equal(getKey('gemini2'), '');
console.log('key2: técnico na 2ª chave e socorro entre chaves ok');
