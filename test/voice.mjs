// Voz: Microsoft neural (servidor simulado, sem rede), escolha de provedor e plano B a partir da ElevenLabs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JARVIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-'));
delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_VOICE_ID;
for (const n of [2, 3, 4]) { delete process.env[`ELEVENLABS_API_KEY_${n}`]; delete process.env[`ELEVENLABS_VOICE_ID_${n}`]; }

const { EDGE, edgeTTS, alignWords } = await import('../lib/edgetts.js');
const sent = [];
let mode = 'ok';
// Servidor simulado: responde como o da Microsoft (metadado de palavras, áudio em binário, turn.end).
EDGE.connect = (url, headers) => {
  assert.match(url, /Sec-MS-GEC=[0-9A-F]{64}/); assert.ok(headers.Origin.startsWith('chrome-extension://'));
  const api = { send: m => { sent.push(m); if (m.includes('Path:ssml')) setTimeout(reply, 5); }, close: () => {} };
  const reply = () => {
    if (mode === 'down') { api.onerror?.({}); api.onclose?.({}); return; }
    const meta = { Metadata: [{ Type: 'WordBoundary', Data: { Offset: 1_000_000, Duration: 3_000_000, text: { Text: 'Bom' } } }, { Type: 'WordBoundary', Data: { Offset: 4_500_000, Duration: 3_000_000, text: { Text: 'dia' } } }, { Type: 'WordBoundary', Data: { Offset: 9_000_000, Duration: 4_000_000, text: { Text: 'senhor' } } }] };
    api.onmessage({ data: `X-RequestId:x\r\nPath:audio.metadata\r\n\r\n${JSON.stringify(meta)}` });
    const head = Buffer.from('X-RequestId:x\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n'), len = Buffer.alloc(2); len.writeUInt16BE(head.length);
    api.onmessage({ data: Buffer.concat([len, head, Buffer.from('MP3DATA')]) });
    api.onmessage({ data: 'X-RequestId:x\r\nPath:turn.end\r\n\r\n{}' });
  };
  setTimeout(() => api.onopen(), 1);
  return api;
};

// 1. Síntese: áudio, tempos por palavra (100 ns → s) e pontuação original na legenda
const r = await edgeTTS('Bom dia, senhor.', { voice: 'pt-BR-AntonioNeural' });
assert.equal(Buffer.from(r.audio, 'base64').toString(), 'MP3DATA');
assert.deepEqual(r.words.map(w => w.w), ['Bom', 'dia,', 'senhor.']);
assert.equal(r.words[1].s, 0.45); assert.equal(r.words[2].e, 1.3);
assert.ok(sent.some(m => m.includes("<voice name='pt-BR-AntonioNeural'>") && m.includes('Bom dia, senhor.')));
// SSML escapado (texto do usuário não injeta marcação)
await edgeTTS('<b>x</b> & "y"');
assert.ok(sent.at(-1).includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
await assert.rejects(edgeTTS('x', { voice: "pt-BR-X'/><evil" }), /inválida/);
assert.deepEqual(alignWords('Olá, mundo!', [{ w: 'Olá', s: 0, e: 1 }, { w: 'mundo', s: 1, e: 2 }]).map(w => w.w), ['Olá,', 'mundo!']);
console.log('voice: Microsoft neural ok');

// 2. Escolha do provedor
const { tts } = await import('../lib/tts.js');
let o = await tts('Bom dia, senhor.');
assert.equal(o.provider, 'edge', 'sem ElevenLabs: Microsoft direto');
await assert.rejects(tts('x', { provider: 'browser' }), e => e.browser === true);
// ElevenLabs configurada mas sem créditos → Microsoft de reserva
process.env.ELEVENLABS_API_KEY = 'key-sem-credito-aaaa'; process.env.ELEVENLABS_VOICE_ID = 'voiceX';
globalThis.fetch = async () => new Response('{}', { status: 402, headers: { 'content-type': 'application/json' } });
o = await tts('Bom dia, senhor.');
assert.equal(o.provider, 'edge'); assert.equal(o.fallback, true);
// Microsoft fora + ElevenLabs fora → erro que manda o navegador falar
mode = 'down';
await assert.rejects(tts('Bom dia.', { provider: 'edge' }), /ElevenLabs/);
delete process.env.ELEVENLABS_API_KEY;
await assert.rejects(tts('Bom dia.'), e => e.browser === true);
console.log('voice: escolha do provedor e planos B ok');

// 3. Preferência salva no perfil é validada
const { saveProfile } = await import('../lib/profile.js');
const p = saveProfile({ voice: { provider: 'hack', edgeVoice: '"><script>', rate: 999, pitch: -999 } }, {});
assert.deepEqual(p.voice, { provider: 'auto', edgeVoice: '', rate: 25, pitch: -25 });
await assert.rejects(edgeTTS('x', { pitch: "-8Hz'><evil" }), /inválidos/);
console.log('voice: perfil ok');
