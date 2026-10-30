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

// ── 429 com corpo do Google: o tipo de limite define a pausa ─────────────────────────────────────────────
const { parseQuotaError, clearBusy } = await import('../lib/router.js');
const body = (quotaId, delay) => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }] },
  ...(delay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] : [])] } });
assert.deepEqual(parseQuotaError(JSON.parse(body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '34s'))), { retryAfter: 34, quota: 'minute' });
assert.deepEqual(parseQuotaError(JSON.parse(body('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '34.5s'))), { retryAfter: 35, quota: 'day' });
assert.deepEqual(parseQuotaError({}, 7), { retryAfter: 7, quota: null });
assert.deepEqual(parseQuotaError(null), { retryAfter: 0, quota: null });

let mode = 'day'; const calls2 = [];
globalThis.fetch = async (u) => {
  const model = decodeURIComponent(String(u).match(/models\/([^:]+):/)?.[1] || ''); calls2.push(model);
  if (model === 'unico') return new Response(mode === 'day' ? body('GenerateRequestsPerDayPerProjectPerModel-FreeTier') : body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '20s'), { status: 429 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
};
// Limite diário no ÚLTIMO da fila (onde antes havia 3 tentativas): uma chamada só, sem esperar.
const solo = { defaultLevel: 'y', reserve: null, levels: { y: { ok: true, primary: { provider: 'gemini', model: 'unico' }, fallback: [] } } };
clearBusy();
await assert.rejects(() => generate(solo, 'y', { system: 's', messages: [{ role: 'user', content: 'oi' }] }), e => e.status === 429 && e.quota === 'day');
assert.deepEqual(calls2, ['unico']);
// Com plano B: o diário pausa o modelo por ~1 h; o por minuto, só pelo tempo que o Google pediu (~22 s), não 5 min.
const duo = { defaultLevel: 'z', reserve: null, levels: { z: { ok: true, primary: { provider: 'gemini', model: 'unico' }, fallback: [{ provider: 'gemini', model: 'planoB' }] } } };
const realNow = Date.now; let t0 = realNow();
for (const [m, expectMin, expectMax] of [['day', 59 * 60_000, 61 * 60_000], ['minute', 21_000, 23_000]]) {
  mode = m; clearBusy(); calls2.length = 0; Date.now = () => t0;
  const r2 = await generate(duo, 'z', { system: 's', messages: [{ role: 'user', content: 'oi' }] });
  assert.equal(r2.meta.model, 'planoB');
  const probe = async (dt) => { Date.now = () => t0 + dt; calls2.length = 0; await generate(duo, 'z', { system: 's', messages: [{ role: 'user', content: 'oi' }] }); return calls2[0]; };
  assert.equal(await probe(expectMin - 1000), 'planoB', `${m}: ainda em pausa`);
  assert.equal(await probe(expectMax + 1000), 'unico', `${m}: pausa terminou`);
}
Date.now = realNow;
console.log('router: 429 por minuto/dia ok');
