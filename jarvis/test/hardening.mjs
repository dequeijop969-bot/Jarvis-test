// Endurecimento da API (fuzz): corpo que não é objeto, 413 de verdade, acentos divididos entre pedaços, erro com código
// estranho não derruba o servidor, HEAD de página, corrida no cadastro, nomes hostis no correio, perfil/skills com tipos
// errados e o HTML do PDF sem nenhum jeito de buscar URL ou rodar script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hard-'));
const PORT = 5000 + Math.floor(Math.random() * 200);
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), JARVIS_CODE_DIR: path.join(DIR, 'code') });
const { server, disposition } = await import('../server.js');
const workspace = await import('../lib/workspace.js');
const fm = await import('../lib/filemaker.js');
const skills = await import('../lib/skills.js');
const { saveProfile } = await import('../lib/profile.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`, H = { 'content-type': 'application/json', 'x-jarvis': '1' };
const post = (p, body) => fetch(B + p, { method: 'POST', headers: H, body: typeof body === 'string' ? body : JSON.stringify(body) });
// Pedido "cru", em pedaços, para testar o readBody.
const raw = (p, chunks, headers = {}) => new Promise(ok => {
  const r = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: p, headers: { host: `localhost:${PORT}`, ...H, ...headers } }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => ok({ status: res.statusCode, body: d }));
  });
  r.on('error', e => ok({ status: 0, body: e.code }));
  (async () => { for (const c of chunks) { r.write(c); await new Promise(z => setTimeout(z, 15)); } r.end(); })();
});

try {
  // Corpo JSON que não é objeto: 400, nunca 500 (antes: TypeError em b.campo).
  for (const b of ['null', '5', '"x"', '[1]']) for (const p of ['/api/profile', '/api/chat', '/api/ui/v', '/api/tts', '/api/actions/toggle', '/api/auth/login'])
    assert.equal((await post(p, b)).status, 400, `${p} ${b}`);
  // Grande demais: 413 respondido (antes o socket era destruído e o cliente só via ECONNRESET).
  let r = await raw('/api/profile', [Buffer.alloc(300_000, 'a')]);
  assert.equal(r.status, 413, r.body);
  r = await raw('/api/profile', [Buffer.alloc(150_000, 'a'), Buffer.alloc(150_000, 'a')], { 'transfer-encoding': 'chunked' });
  assert.equal(r.status, 413, 'sem content-length também');
  // "Ç" dividido entre dois pedaços chega inteiro.
  const body = Buffer.from(JSON.stringify({ name: 'ÇÇÇ João', address: 'senhor' })), cut = body.indexOf(0xc3) + 1;
  r = await raw('/api/profile', [body.subarray(0, cut), body.subarray(cut)]);
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).profile.name, 'ÇÇÇ João');

  // Erro com código que não é HTTP ('EPERM', -32601): 500 limpo, e o servidor continua de pé.
  const pick0 = workspace.WS.pick;
  workspace.WS.pick = async () => { throw Object.assign(new Error('interno'), { code: 'EPERM' }); };
  assert.equal((await post('/api/workspace/pick', {})).status, 500);
  workspace.WS.pick = async () => { throw Object.assign(new Error('rpc'), { code: -32601 }); };
  assert.equal((await post('/api/workspace/pick', {})).status, 500);
  workspace.WS.pick = pick0;
  assert.equal((await fetch(B + '/api/health')).status, 200, 'servidor vivo');

  // HEAD de página responde (antes 404); na API continua fora.
  assert.equal((await fetch(B + '/app', { method: 'HEAD' })).status, 200);
  // "ids" que não é lista: 410, não 500.
  assert.equal((await post('/api/actions/undo', { ids: 'abc' })).status, 410);

  // Cadastro: 8 iguais ao mesmo tempo = 1 conta só (antes: 8 contas com o mesmo e-mail).
  const rs = await Promise.all(Array.from({ length: 8 }, () => post('/api/auth/register', { name: 'Corrida', email: 'race@x.com', password: 'abcdefgh12' }).then(x => x.status)));
  assert.equal(rs.filter(s => s === 200).length, 1, rs.join(','));
  assert.equal(JSON.parse(fs.readFileSync(path.join(DIR, 'users.json'), 'utf8')).users.filter(u => u.email === 'race@x.com').length, 1);

  // Anexo com nome que não é texto e com escape quebrado: sem mensagem interna em inglês.
  let j = await (await post('/api/files', { name: { toString: 1 }, data: 'data:text/plain,oi' })).json();
  assert.equal(j.name, 'arquivo');
  r = await post('/api/files', { name: 'x.txt', data: 'data:text/plain,%E0%A4%A' });
  assert.equal(r.status, 400); assert.doesNotMatch((await r.json()).error, /URI malformed/);
  // Correio: nome hostil no Content-Disposition fica só em ASCII seguro + filename* codificado.
  const cd = disposition('attachment', 'o\'(x)*;%"\\ção 日本.txt');
  assert.match(cd, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/, cd);
  assert.ok(!/["\\;%]/.test(cd.match(/filename="([^"]*)"/)[1]));
  await post('/api/files', { name: 'a"b\r\nc.txt', data: 'data:text/plain,oi' });
  const it = (await (await fetch(B + '/api/correio')).json()).itens.find(x => x.name.startsWith('a_b'));
  r = await fetch(`${B}/api/correio/${it.id}/arquivo`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /^attachment; filename="a_b__c\.txt"/);

  // Perfil: listas com objetos/null não viram "[object Object]"; a voz escolhida é aceita (regex tinha "w+" sem barra).
  const p = saveProfile({ about: { ferramentas: [{ a: 1 }, null, 'VS Code', 3], interesses: { x: 1 } }, voice: { edgeVoice: 'pt-BR-FranciscaNeural' } }, {});
  assert.deepEqual(p.about.ferramentas, ['VS Code', '3']); assert.deepEqual(p.about.interesses, []);
  assert.equal(p.voice.edgeVoice, 'pt-BR-FranciscaNeural');
  // Skills: passo que não é texto não vira o pedido "[object Object]".
  assert.throws(() => skills.clean({ name: 'x', steps: { a: 1 } }), /pelo menos um passo/);
  assert.deepEqual(skills.clean({ name: 'x', steps: ['oi', { a: 1 }, 5] }).steps, ['oi']);

  // PDF: nada de atributo, URL ou script, nem pelos atalhos que passavam antes.
  const evil = ['<p/onclick=alert(1)>a</p>', '<div/style=background:url(http://evil/a)>b</div>', '<td background=http://evil/x.png>c</td>', '<table background="http://evil">',
    '<img src=//evil/x', '<script src=//evil', '<scr<script></script>ipt>alert(1)</script>', '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<style>@import url(http://evil)</style>', '<svg><image href=http://evil /></svg>', '<div tabindex=1 autofocus onfocus=alert(1)>', '<base href=http://evil/>',
    '<meta http-equiv=refresh content="0;url=http://evil">', '<link rel=stylesheet href=http://evil>', '<!--<img src=x>-->', '<p title="x>"onclick=alert(1)>'];
  for (const e of evil) {
    const h = fm.safeHtml(e);
    assert.ok(!/<[a-z][^>]*\s*[a-z-]+\s*=|<(img|script|style|iframe|svg|base|meta|link|a)\b|url\(/i.test(h), `${e} => ${h}`);
  }
  assert.equal(fm.safeHtml('<h2 class="x">T</h2><td colspan="2" style="x">1</td>'), '<h2>T</h2><td colspan="2">1</td>');
  assert.match(fm.pdfHtml('T', '<p>x</p>'), /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  assert.ok(!/script-src/.test(fm.PDF_CSP), 'sem script na página impressa');
  const args = fm.chromeArgs(DIR, 'o.pdf', 'C:\\x\\doc.html');
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND') && args.includes('--disable-extensions'));
  assert.equal(args.at(-1), 'file:///C:/x/doc.html');
} finally { server.close(); }
console.log('hardening: corpo inválido, 413, UTF-8, erro sem derrubar, HEAD, corrida no cadastro, correio, perfil, skills e PDF seguro ok');
process.exit(0);
