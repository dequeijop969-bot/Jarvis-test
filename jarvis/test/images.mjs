// Busca e exportação de imagens: intenção de voz, provedores (Google/Openverse), bloqueio de IP privado, ZIP e rotas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-img-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'imgTestGeminiKey-0000' });
delete process.env.GOOGLE_CSE_KEY; delete process.env.GOOGLE_CSE_ID;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const hits = [], realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url); if (u.startsWith("http://localhost")) return realFetch(url, opt); hits.push(u);
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://api.openverse.org/') && (u.includes('q=meme+do') || u.includes('q=zzznada'))) return json({ results: [] });
  if (u.startsWith('https://api.openverse.org/')) return json({ results: [
    { title: 'Saturno', url: 'https://img.example.org/saturno.png', thumbnail: 'https://img.example.org/t/saturno.png', source: 'nasa', foreign_landing_url: 'https://example.org/saturno', license: 'by', license_version: '4.0', creator: 'NASA' },
    { title: 'Anéis', url: 'https://img.example.org/aneis.png', thumbnail: '', source: 'flickr' },
    { title: 'Interno', url: 'https://intranet.example.org/x.png' },
    { title: 'Ruim', url: 'javascript:alert(1)' }
  ] });
  if (u.startsWith('https://www.googleapis.com/customsearch/')) {
    if (process.env.GOOGLE_CSE_KEY === 'quota') return json({ error: { message: 'quota' } }, 429);
    return json({ items: [{ link: 'https://img.example.org/g1.png', title: 'Do Google', displayLink: 'example.org', image: { thumbnailLink: 'https://img.example.org/t/g1.png', contextLink: 'https://example.org/g1' } }] });
  }
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    const last = String(JSON.parse(opt.body).contents.at(-1).parts[0].text);
    if (last.includes('apresenta')) {
      // IA simulada: apresentação com slides de foto (um deles com busca impossível → segue sem foto)
      const text = JSON.stringify({ topic: 'Saturno', intro: 'Permita-me, senhor.', chart: null, outro: '', remember: [], image_search: '', slides: [
        { title: 'O planeta', fact: 'Sexto a partir do Sol', narration: 'Saturno é o sexto planeta do Sistema Solar.', chart: null, image: 'Saturno Cassini', points: ['Gigante gasoso', 'Anéis de gelo'] },
        { title: 'Sem foto', fact: 'x', narration: 'Um slide cuja busca falha.', chart: null, image: 'zzznada' },
        { title: 'Números', fact: 'y', narration: 'Um slide só com gráfico.', chart: { type: 'bignumber', title: 'Luas', unit: '', data: [{ label: 'luas', value: 146 }] } }] });
      return json({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    // IA simulada: pedido de imagem sem tema → ela devolve o campo image_search usando o contexto.
    const text = JSON.stringify({ topic: 'Imagens', intro: 'Aqui estão alguns memes do Verity, senhor.', chart: null, slides: [], outro: '', remember: [], image_search: 'meme do verity' });
    return json({ candidates: [{ content: { parts: [{ text }] } }] });
  }
  if (u === 'https://img.example.org/redir.png') return new Response(null, { status: 302, headers: { location: 'https://intranet.example.org/x.png' } });
  if (u.startsWith('https://img.example.org/')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG.length) } });
  return new Response('nope', { status: 404 });
};

const images = await import('../lib/images.js');
images.IMAGES.resolve = async host => [{ address: host.startsWith('intranet') ? '10.0.0.5' : '93.184.216.34' }];
const { detectIntent, imagesQuery } = await import('../lib/assistant.js');

// 1. Intenção de voz
const q = t => detectIntent(t)?.kind === 'images' ? detectIntent(t).query : null;
assert.equal(q('pesquisa imagens de estação espacial'), 'estação espacial');
assert.equal(q('me mostra fotos de Saturno'), 'Saturno');
assert.equal(q('busca imagens de pôr do sol no google'), 'pôr do sol');
assert.equal(q('imagens de gatos dormindo'), 'gatos dormindo');
assert.equal(q('o que tenho na agenda hoje'), null);
assert.equal(q('exclui os e-mails da loja'), null);
assert.equal(imagesQuery('gosto de fotos'), null);
// Frases reais que antes caíam na conversa comum
assert.equal(q('pode me pesquisar um meme no Google'), 'meme');
assert.equal(q('cara pesquisa um meme'), 'meme');
assert.equal(q('manda um meme do verity'), 'meme do verity');
assert.equal(q('pesquisa no google imagens de gatos'), 'gatos');
assert.equal(q('me mostre uma imagem'), null, 'sem tema: a IA decide pelo contexto');
assert.equal(detectIntent('o que tenho na agenda hoje').kind, 'agenda', 'agenda continua funcionando');
console.log('images: intenção de voz ok');

// 2. Busca sem chave do Google → Openverse; URLs inválidas descartadas; IDs opacos
let r = await images.searchImages('Saturno');
assert.equal(r.provider, 'openverse');
assert.equal(r.items.length, 3, 'javascript: descartado');
assert.ok(r.items.every(x => /^[a-f0-9]{16}$/.test(x.id) && !('url' in x)), 'o navegador nunca recebe a URL externa');
assert.equal(r.items[0].license, 'CC BY 4.0');
// Com chave do Google → Google; cota estourada → volta para o Openverse
process.env.GOOGLE_CSE_KEY = 'okKeyForGoogleCse'; process.env.GOOGLE_CSE_ID = 'cx1';
const g = await images.searchImages('Saturno');
assert.equal(g.provider, 'google'); assert.equal(g.items[0].title, 'Do Google');
assert.ok(hits.some(h => h.includes('searchType=image')));
process.env.GOOGLE_CSE_KEY = 'quota';
const fb = await images.searchImages('Saturno');
assert.equal(fb.provider, 'openverse'); assert.equal(fb.fallback, true);
delete process.env.GOOGLE_CSE_KEY; delete process.env.GOOGLE_CSE_ID;
// Sem resultado exato: tenta versões mais curtas ("meme do verity" → "meme verity")
const rx = await images.searchImages('meme do verity');
assert.equal(rx.relaxed, true); assert.equal(rx.used, 'meme verity'); assert.ok(rx.items.length);
console.log('images: provedores e plano B ok');

// 3. Download: imagem pública ok; host privado recusado
const ok = await images.getFull(r.items[0].id);
assert.equal(ok.type, 'image/png'); assert.match(ok.name, /^saturno\.png$/);
await assert.rejects(images.getFull(r.items[2].id), /baixar/, 'IP privado (10.x) é recusado');
await assert.rejects(images.getFull('ffffffffffffffff'), /expirou/);
console.log('images: download seguro ok');

// 4. ZIP válido, com CREDITOS.txt
const z = await images.zipImages([r.items[0].id, r.items[1].id, r.items[2].id]);
assert.equal(z.count, 2); assert.equal(z.skipped, 1);
const names = []; for (let off = 0; z.buf.readUInt32LE(off) === 0x04034b50;) {
  const size = z.buf.readUInt32LE(off + 18), nl = z.buf.readUInt16LE(off + 26), name = z.buf.slice(off + 30, off + 30 + nl).toString();
  const data = z.buf.slice(off + 30 + nl, off + 30 + nl + size); names.push(name);
  assert.equal(z.buf.readUInt32LE(off + 14), zlib.crc32 ? zlib.crc32(data) : z.buf.readUInt32LE(off + 14), 'CRC confere');
  off += 30 + nl + size;
}
assert.deepEqual(names, ['01-saturno.png', '02-aneis.png', 'CREDITOS.txt']);
assert.equal(z.buf.readUInt32LE(z.buf.length - 22), 0x06054b50);
console.log('images: ZIP ok');

// 5. Rotas HTTP
const { server } = await import('../server.js');
await new Promise(res => server.listen(PORT, '127.0.0.1', res));
const B = `http://localhost:${PORT}`;
const rf = (p, o = {}) => fetch(B + p, o);
try {
  const s = await (await rf('/api/images/search?q=saturno')).json();
  assert.equal(s.items.length, 3);
  let x = await rf(`/api/images/${s.items[0].id}/thumb`);
  assert.equal(x.status, 200); assert.equal(x.headers.get('content-type'), 'image/png'); assert.match(x.headers.get('content-security-policy'), /sandbox/);
  x = await rf(`/api/images/${s.items[0].id}/file`);
  assert.match(x.headers.get('content-disposition'), /attachment; filename="saturno\.png"/);
  x = await rf('/api/images/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [s.items[0].id] }) });
  assert.equal(x.status, 403, 'ZIP exige x-jarvis');
  x = await rf('/api/images/zip', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ ids: [s.items[0].id, s.items[1].id] }) });
  assert.equal(x.status, 200); assert.equal(x.headers.get('content-type'), 'application/zip'); assert.equal(x.headers.get('x-jarvis-count'), '2');
  x = await rf('/api/images/zip', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ ids: ['../../etc'] }) });
  assert.equal(x.status, 400);
  // Conversa: a IA pede imagens (image_search) e a resposta já vem com a galeria
  const c = await (await rf('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ text: 'me mostre uma imagem' }) })).json();
  assert.equal(c.image_search, 'meme do verity'); assert.ok(c.images?.items?.length >= 1, 'galeria anexada à resposta da IA');
  const v = await (await rf('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ text: 'pode me pesquisar um meme no Google' }) })).json();
  assert.equal(v.images?.query, 'meme'); assert.equal(v.meta.tier, 'local', 'atalho local, sem gastar IA');
  // Apresentação: slides com "image" ganham fotos; os demais seguem como estavam
  const ap = await (await rf('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ text: 'me apresenta Saturno' }) })).json();
  assert.ok(ap.slides[0].img?.items?.length >= 1, 'slide 1 com foto'); assert.deepEqual(ap.slides[0].points, ['Gigante gasoso', 'Anéis de gelo']);
  assert.equal(ap.slides[1].img, undefined, 'busca sem resultado: slide sem foto'); assert.equal(ap.slides[2].chart.type, 'bignumber');
  const st = await (await rf('/api/state')).json();
  assert.equal(st.integrations.images.provider, 'openverse');
  const land = await (await rf('/guia')).text(), app = await (await rf('/app')).text();
  assert.match(land, /Primeiros passos/); assert.match(app, /id="images-js"/); assert.match(app, /BOARDS\.gallery/);
  assert.ok(app.includes('window.wirePhoto') && app.includes('photoFig(photo)'), 'foto no slide');
  console.log('images: rotas HTTP ok');
} finally { server.close(); }
