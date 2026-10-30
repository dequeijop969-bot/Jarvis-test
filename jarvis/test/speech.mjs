// Voz mais precisa: correção de nomes, escolha do melhor palpite do Chrome, dúvida e a segunda opinião da IA (áudio).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-speech-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'speechTestGemini-0000' });
const S = await import('../lib/speech.js');

// 1. Correções comuns do reconhecimento em pt-BR (mantém o resto da frase, com acentos).
const fx = [
  ['jarbas abre a estime e inicia o geometria dash', 'Jarvis abre a Steam e inicia o Geometry Dash'],
  ['abre o vê esse code e cria um site', 'abre o VS Code e cria um site'],
  ['Jarvas entra na chamada do servidor Sei lá no dis cord', 'Jarvis entra na chamada do servidor Sei lá no Discord'],
  ['abre o you tube e o git hub', 'abre o YouTube e o GitHub'],
  ['aperta controle k', 'aperta Ctrl+K'],
  ['qual é a previsão do tempo amanhã', 'qual é a previsão do tempo amanhã']   // nada para corrigir
];
for (const [a, b] of fx) assert.equal(S.fixSpeech(a), b, a);
assert.equal(S.fixSpeech('já vi esse filme'), 'já vi esse filme', '"já vi" de verdade não vira Jarvis');

// 2. Entre os palpites, ganha o que tem palavras conhecidas (mesmo com confiança um pouco menor).
const vocab = new Set(['discord', 'steam', 'vs code', 'call']);
let b = S.pickBest([{ text: 'abre o disco e entra na cal', conf: .71 }, { text: 'abre o discord e entra na call', conf: .64 }], vocab);
assert.equal(b.text, 'abre o discord e entra na call');
b = S.pickBest([{ text: 'qual a previsão do tempo', conf: .93 }, { text: 'qual a previsão do templo', conf: .4 }], vocab);
assert.equal(b.text, 'qual a previsão do tempo', 'sem palavras conhecidas, vale a confiança');
assert.equal(S.pickBest([], vocab), null);

// 3. Dúvida: confiança baixa ou curto demais para ser um pedido.
assert.equal(S.doubtful({ text: 'abre o discord', conf: .5 }), true);
assert.equal(S.doubtful({ text: 'abre o discord', conf: .9 }), false);
assert.equal(S.doubtful({ text: 'jarvis', conf: .7 }), true);
assert.equal(S.doubtful({ text: 'abre steam', conf: .7 }), false, 'curto, mas é um comando');

// 4. Pelo servidor: pedido falado é corrigido (e devolve o que foi entendido); o digitado não é mexido.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => {
  if (String(u).startsWith('http://localhost')) return realFetch(u, o);
  const body = o?.body ? JSON.parse(o.body) : {}; sent.push(body);
  const parts = body.contents?.at(-1)?.parts || [];
  const audio = parts.find(p => p.inlineData?.mimeType === 'audio/wav');
  const text = audio ? JSON.stringify({ texto: 'jarbas abre a estime' }) : JSON.stringify({ acao: 'nenhuma', resposta: 'ok' });
  return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
};
const { server } = await import('../server.js');
const { saveProfile } = await import('../lib/profile.js');
saveProfile({ name: 'Teste', address: 'senhor', lang: 'pt-BR', city: { name: 'Jundiaí', latitude: -23.2, longitude: -46.9, timezone: 'America/Sao_Paulo' } }, null);
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const post = (p, body) => fetch(`http://localhost:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) });
try {
  let j = await (await post('/api/chat', { text: 'jarbas qual o seu nome', mode: 'code', voice: true, conf: .8, alts: [] })).json();
  assert.equal(j.heard, 'Jarvis qual o seu nome');
  j = await (await post('/api/chat', { text: 'jarbas qual o seu nome', mode: 'code' })).json();
  assert.equal(j.heard, undefined, 'digitado: não mexe');
  // Segunda opinião: o áudio vai para o Gemini como WAV, com os nomes conhecidos; a resposta também é corrigida.
  const wav = 'data:audio/wav;base64,' + Buffer.alloc(64).toString('base64');
  sent.length = 0;
  j = await (await post('/api/stt', { audio: wav, chrome: 'jarbas abre a' })).json();
  assert.equal(j.text, 'Jarvis abre a Steam');
  assert.ok(sent.some(b => JSON.stringify(b).includes('"mimeType":"audio/wav"')));
  assert.match(JSON.stringify(sent[0].systemInstruction), /Discord/);
  assert.equal((await post('/api/stt', { audio: 'data:audio/mp3;base64,AAAA' })).status, 400, 'só WAV');
  console.log('speech: correção, melhor palpite, dúvida e transcrição pela IA ok');
} finally { server.close(); globalThis.fetch = realFetch; }
