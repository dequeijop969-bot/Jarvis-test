// Disjuntor do roteador: modelo sem cota (429) é pulado por um tempo, sem novas tentativas, e o plano B responde na hora.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JARVIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-router-'));
process.env.GEMINI_API_KEY = 'routerTestGemini-0000';
const calls = [];
globalThis.fetch = async (u) => {
  const model = decodeURIComponent(String(u).match(/models\/([^:]+):/)?.[1] || '');
  calls.push(model);
  if (model === 'principal') return new Response('{}', { status: 429 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
};
const { generate, ROUTER, clearCooling } = await import('../lib/router.js');
ROUTER.baseDelay = 1;
const models = {
  defaultLevel: 'x', reserve: null,
  levels: { x: { ok: true, primary: { provider: 'gemini', model: 'principal' }, fallback: [{ provider: 'gemini', model: 'planoB' }] } }
};
const ask = () => generate(models, 'x', { system: 's', messages: [{ role: 'user', content: 'oi' }] });

// 1º pedido: o principal dá 429 UMA vez (sem esperar novas tentativas) e o plano B responde.
let r = await ask();
assert.equal(r.meta.model, 'planoB'); assert.deepEqual(calls, ['principal', 'planoB']);
// 2º pedido: o principal está em pausa e nem é chamado.
calls.length = 0; r = await ask();
assert.equal(r.meta.model, 'planoB'); assert.deepEqual(calls, ['planoB']);
// Pausa encerrada: volta a tentar o principal.
clearCooling(); calls.length = 0; await ask();
assert.equal(calls[0], 'principal');
console.log('router: disjuntor de cota ok');
