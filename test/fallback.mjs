// Fallback entre contas ElevenLabs: a conta 1 sem créditos (402), a 2 com limite (429), a 3 funciona.
process.env.ELEVENLABS_API_KEY = 'key-conta-1-aaaaaa';
process.env.ELEVENLABS_API_KEY_2 = 'key-conta-2-bbbbbb';
process.env.ELEVENLABS_API_KEY_3 = 'key-conta-3-cccccc';
process.env.ELEVENLABS_API_KEY_4 = 'key-conta-4-dddddd';
process.env.ELEVENLABS_VOICE_ID = 'voiceTest01';
process.env.JARVIS_DATA_DIR = '/tmp/jarvis-fb-test';
const calls = [];
globalThis.fetch = async (u, o) => {
  const k = o.headers['xi-api-key']; calls.push(k.slice(10, 16));
  const st = k.includes('conta-1') ? 402 : k.includes('conta-2') ? 429 : 200;
  return new Response(st === 200 ? JSON.stringify({ audio_base64: 'QUJD' }) : '{}', { status: st, headers: { 'content-type': 'application/json' } });
};
const { tts } = await import('../lib/tts.js');
const r = await tts('olá');
console.assert(r.audio === 'QUJD', 'deveria ter áudio da conta 3');
console.assert(!calls.includes('dddddd'), 'conta 4 não deveria ser usada');
console.log('fallback: ok · ordem das contas tentadas:', [...new Set(calls)].join(' → '));
