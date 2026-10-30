// Voz pelo VoiceStudio: legenda cronometrada pelo áudio, pausas encurtadas e reserva na Microsoft.
import assert from 'node:assert/strict';
import { readWav, writeWav, speechSegments, tightenPauses, trimRunaway, wordTimes, vsTTS, VS, warmVoiceStudio } from '../lib/voicestudio.js';

// Áudio sintético: tom de 220 Hz nos trechos de "fala", silêncio no resto.
const RATE = 24000;
function synth(parts) {   // [[segundos, fala?], ...]
  const n = parts.reduce((a, [d]) => a + Math.round(d * RATE), 0), s = new Float32Array(n); let o = 0;
  for (const [d, on] of parts) { const k = Math.round(d * RATE); if (on) for (let i = 0; i < k; i++) s[o + i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / RATE); o += k; }
  return { samples: s, rate: RATE };
}

// 1. WAV ida e volta
const a = synth([[0.3, false], [0.8, true], [1.5, false], [1.2, true], [0.2, false]]);
const back = readWav(writeWav(a));
assert.equal(back.rate, RATE); assert.equal(back.samples.length, a.samples.length);
assert.ok(Math.abs(back.samples[RATE / 2] - a.samples[RATE / 2]) < 1e-3);

// 2. Trechos de fala detectados onde estão
const segs = speechSegments(a);
assert.equal(segs.length, 2);
assert.ok(Math.abs(segs[0][0] - 0.3) < 0.03 && Math.abs(segs[0][1] - 1.1) < 0.03, JSON.stringify(segs));
assert.ok(Math.abs(segs[1][0] - 2.6) < 0.03, JSON.stringify(segs));

// 3. Pausa de 1,5 s vira 0,35 s; silêncio inicial vira ~50 ms
const t = tightenPauses(a), ts = speechSegments(t);
assert.ok(ts[0][0] <= 0.06, `início ${ts[0][0]}`);
assert.ok(Math.abs((ts[1][0] - ts[0][1]) - 0.35) < 0.03, `pausa ${ts[1][0] - ts[0][1]}`);
assert.ok(t.samples.length / RATE < 2.7, 'ficou mais curto');

// 4. Palavras: cada frase no seu trecho; nada começa durante a pausa
const w = wordTimes('Boa noite, senhor. Todos os sistemas operacionais.', [[0, 0.9], [1.25, 3.0]]);
assert.deepEqual(w.map(x => x.w), ['Boa', 'noite,', 'senhor.', 'Todos', 'os', 'sistemas', 'operacionais.']);
assert.equal(w[3].s, 1.25, 'a segunda frase começa quando a fala volta');
assert.ok(w[2].e <= 0.9 && w.every((x, i) => i === 0 || x.s >= w[i - 1].s));
// A voz também pausa sem vírgula: o corte vai para onde a duração manda
const w2 = wordTimes('o senhor tem três compromissos amanhã e o primeiro é às nove', [[0, 1.4], [1.8, 2.3], [2.7, 4.3]]);
assert.equal(w2.find(x => x.w === 'amanhã').s, 1.8);
assert.equal(wordTimes('', [[0, 1]]), null);
assert.equal(wordTimes('oi', []), null);
// Motor "falando sozinho" depois da frase: o trecho que começa muito depois do esperado sai
const run = synth([[0.05, false], [1.2, true], [0.3, false], [1.0, true], [0.35, false], [2.0, true]]);
const cut = trimRunaway(run, 'Às suas ordens, senhor.');
assert.ok(cut.samples.length / RATE < 2.8 && cut.samples.length / RATE > 2.5, `cortou a cauda: ${cut.samples.length / RATE}`);
assert.equal(trimRunaway(a, 'Boa noite, senhor. Todos os sistemas estão operacionais, senhor.').samples.length, a.samples.length, 'frase normal intacta');
console.log('voicestudio: legenda cronometrada e pausas ok');

// 5. Chamada HTTP: WAV com pausa longa → áudio encurtado + palavras; erro → disjuntor
const origFetch = globalThis.fetch;
process.env.VOICESTUDIO_VOICE = 'teste123';
let sent = null;
globalThis.fetch = async (url, opt) => { sent = { url, body: JSON.parse(opt.body) }; return new Response(writeWav(a), { status: 200, headers: { 'content-type': 'audio/wav' } }); };
const r = await vsTTS('Boa noite, senhor. Tudo em ordem.');
assert.equal(sent.url, 'http://127.0.0.1:3900/v1/audio/speech');
assert.equal(sent.body.voice, 'teste123'); assert.equal(sent.body.response_format, 'wav');
assert.equal(r.provider, 'voicestudio'); assert.equal(r.mime, 'audio/wav');
assert.equal(r.words.length, 6); assert.ok(r.words[3].s > 0.5, 'segunda frase depois da pausa');
assert.ok(readWav(Buffer.from(r.audio, 'base64')).samples.length < a.samples.length, 'pausa encurtada');
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'voz não encontrada' } }), { status: 404 });
await assert.rejects(vsTTS('Oi.'), /404/);
assert.ok(VS.downUntil > Date.now(), 'fora do ar por um tempo');
await assert.rejects(vsTTS('Oi.'), /fora do ar/);
// Fila: uma frase por vez, na ordem pedida; 429 (ocupado) espera e tenta de novo, sem tirar o VoiceStudio da vez
VS.downUntil = 0; let busyOnce = true, running = 0, maxRunning = 0; const order = [];
globalThis.fetch = async (url, opt) => {
  const txt = JSON.parse(opt.body).input;
  if (busyOnce && txt === 'Dois.') { busyOnce = false; return new Response('{"error":{"message":"saturated"}}', { status: 429 }); }
  running++; maxRunning = Math.max(maxRunning, running); await new Promise(z => setTimeout(z, 40)); running--; order.push(txt);
  return new Response(writeWav(a), { status: 200 });
};
const rs = await Promise.all(['Um.', 'Dois.', 'Três.'].map(t => vsTTS(t)));
assert.deepEqual(order, ['Um.', 'Dois.', 'Três.'], 'na ordem'); assert.equal(maxRunning, 1, 'uma por vez');
assert.ok(rs.every(r => r.provider === 'voicestudio')); assert.equal(VS.downUntil, 0, '429 não tira da vez');
console.log('voicestudio: fila, ordem e ocupado ok');
// Motor recarregando (demora): fica de lado só ~15 s e aquece em segundo plano; quando aquece, volta na hora
VS.downUntil = 0; VS.timeout = 60; let calls = 0;
const hold = setInterval(() => {}, 1000);   // AbortSignal.timeout não segura o processo aberto sozinho
globalThis.fetch = (url, opt) => { calls++; return new Promise((res, rej) => {
  if (opt.body.includes('Pronto.')) return setTimeout(() => res(new Response(writeWav(a), { status: 200 })), 80);
  opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
}); };
await assert.rejects(vsTTS('Oi.'), /demorou/);
const wait = VS.downUntil - Date.now();
assert.ok(wait > 10_000 && wait <= 15_000, `só 15 s de lado, não 2 min: ${wait}`);
assert.ok(VS.warming, 'aquecendo em segundo plano'); assert.equal(await VS.warming, true);
assert.equal(VS.downUntil, 0, 'aqueceu: volta a usar o VoiceStudio'); assert.equal(calls, 2);
assert.equal(await warmVoiceStudio(), true);
VS.timeout = 20_000; clearInterval(hold);
globalThis.fetch = origFetch; delete process.env.VOICESTUDIO_VOICE; VS.downUntil = 0;
console.log('voicestudio: aquecimento e espera curta ok');
console.log('voicestudio: chamada, erro e disjuntor ok');
