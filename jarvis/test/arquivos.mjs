// Arquivos e projetos, ponta a ponta (Gemini falso): TODOS os anexos vão para a IA (não só o primeiro), as imagens que
// você manda entram no arquivo criado, o arquivo só é escrito e entregue no correio, e a memória do projeto vale nas
// conversas seguintes (anotar, listar, editar "o da padaria" sem mandar de novo).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-arq-')), OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-arq-out-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'fakeGeminiKey-arquivos-1234' });
for (const k of ['GEMINI_API_KEY_2', 'ANTHROPIC_API_KEY']) delete process.env[k];
process.env.GEMINI_API_KEY_PAGO = 'fakePagoKey-arquivos-5678';   // a chave paga existe: mesmo assim, só é usada com o 5.1 selecionado

// Gemini falso: guarda cada pedido e responde conforme o tipo (arquivo ou conversa).
const asks = [];
let plan = null, decision = null;   // decision: o que o classificador responde (null = resposta torta: a lista de palavras decide)
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, opt);
  const body = JSON.parse(opt.body), sys = body.systemInstruction?.parts?.[0]?.text || '';
  const last = body.contents.at(-1).parts;
  asks.push({ model: decodeURIComponent(String(url).match(/models\/([^:]+):/)?.[1] || ''), sys, text: last[0].text, images: last.filter(p => p.inlineData?.mimeType === 'image/jpeg').length, pdfs: last.filter(p => p.inlineData?.mimeType === 'application/pdf').length });
  const out = sys.includes('CLASSIFICADOR DE PEDIDOS') ? (decision || { nada: 1 }) : sys.includes('vai produzir um ARQUIVO') ? plan : { intro: 'Vi tudo, senhor.', slides: [], outro: '' };
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const fm = await import('../lib/filemaker.js');
fm.OUT.dir = () => OUTDIR;
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => null); return { status: r.status, j }; };
const get = async p => (await fetch(B + p, { headers: { 'x-jarvis': '1' } })).json();
const jpg = n => 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64');
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7 cardapio antigo').toString('base64');

try {
  await post('/api/profile', { name: 'Ana Souza', address: 'senhor', city: { name: 'Jundiaí', latitude: -23.18, longitude: -46.89, timezone: 'America/Sao_Paulo' }, lang: 'pt-BR' });

  // 1. Duas imagens e um PDF: os três vão para a IA, no mesmo pedido.
  const f1 = (await post('/api/files', { name: 'pao.jpg', type: 'image/jpeg', data: jpg(1) })).j;
  const f2 = (await post('/api/files', { name: 'bolo.jpg', type: 'image/jpeg', data: jpg(2) })).j;
  const f3 = (await post('/api/files', { name: 'cardapio.pdf', type: 'application/pdf', data: pdf })).j;
  let r = await post('/api/chat', { text: 'o que tem nesses arquivos?', files: [f1.id, f2.id, f3.id] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  let a = asks.at(-1);
  assert.equal(a.images, 2, 'as duas imagens foram'); assert.equal(a.pdfs, 1, 'o PDF também');
  assert.match(a.text, /imagem 2 "bolo\.jpg"/); assert.match(a.text, /TODOS/);

  // 2. "Cria uma página com essas fotos": escrita e entregue no correio, com as DUAS imagens dentro.
  plan = { formato: 'html', nome: 'galeria padaria', titulo: 'Galeria', tema: 'ambar', conteudo: '<!doctype html><h1>Padaria</h1><img src="anexo:1" alt="pão"><img src="anexo:2" alt="bolo"><img src="anexo:9">',
    projeto: 'Padaria Pão Quente', nota: 'Galeria com as fotos do pão e do bolo, fundo creme', fala: 'Montei a galeria.' };
  r = await post('/api/chat', { text: 'cria uma página html com essas fotos', files: [f1.id, f2.id] });
  a = asks.at(-1);
  assert.equal(a.images, 2); assert.match(a.sys, /anexo:2 = "bolo\.jpg"/); assert.match(a.sys, /Não diga que vai abrir, rodar ou instalar/);
  assert.ok(r.j.correio, 'entregue no correio'); assert.equal(r.j.projeto, 'Padaria Pão Quente');
  const out = fs.readdirSync(OUTDIR).find(n => n.endsWith('.html'));
  const html = fs.readFileSync(path.join(OUTDIR, out), 'utf8');
  assert.equal((html.match(/src="data:image\/jpeg;base64,/g) || []).length, 2, 'as duas fotos dentro da página');
  assert.ok(!html.includes('anexo:9'), 'imagem que não existe sai');
  // No modo Code (sem pasta de projeto), criar também só escreve e entrega: nada de abrir o VS Code.
  plan = { formato: 'py', nome: 'contas', titulo: 'Contas', conteudo: 'print("oi")', projeto: 'Padaria Pão Quente', nota: 'script de contas', fala: 'Pronto.' };
  r = await post('/api/chat', { text: 'escreve um script python que soma as vendas', mode: 'code' });
  assert.ok(r.j.correio, 'script entregue no correio'); assert.ok(!r.j.written, 'não foi para o VS Code');
  assert.ok(fs.readdirSync(OUTDIR).some(n => n === 'contas.py'));
  // O seletor manda: com 2.5 selecionado, nenhum arquivo vai para o modelo pago (mesmo com a chave dele).
  const fileModels = asks.filter(x => x.sys.includes('vai produzir um ARQUIVO')).map(x => x.model);
  assert.ok(fileModels.length >= 2 && fileModels.every(m => !/argon/.test(m)), fileModels.join());

  // 3. Projetos: anotar e listar (sem IA).
  const n0 = asks.length;
  r = await post('/api/chat', { text: 'anota no projeto padaria: o logo é vermelho e o público é de bairro' });
  assert.match(r.j.intro, /Anotado no projeto Padaria Pão Quente/);
  r = await post('/api/chat', { text: 'quais projetos você lembra?' });
  assert.match(r.j.intro, /Padaria Pão Quente \(2 arquivos\)/);
  assert.equal(asks.length, n0, 'anotar e listar não gastam IA');

  // 4. A memória do projeto vai junto quando ele é citado.
  r = await post('/api/chat', { text: 'qual a cor do logo da padaria?' });
  a = asks.at(-1);
  assert.match(a.sys, /MEMÓRIA DO PROJETO "Padaria Pão Quente"/); assert.match(a.sys, /o logo é vermelho/); assert.match(a.sys, /galeria-padaria\.html/);

  // 5. "Edita a galeria da padaria e me manda": o último arquivo do projeto volta como anexo, sem mandar de novo.
  plan = { formato: 'html', nome: 'x', titulo: 'Galeria', conteudo: '<!doctype html><h1>PADARIA</h1>', projeto: 'Padaria Pão Quente', nota: 'título maior', fala: 'Aumentei o título.' };
  r = await post('/api/chat', { text: 'edita a galeria da padaria e me manda com o título maior' });
  a = asks.at(-1);
  assert.match(a.sys, /pediu uma alteração/); assert.match(a.text, /ARQUIVO "galeria-padaria\.html"/, 'a galeria (citada) foi junto, não o script mais recente');
  assert.ok(r.j.correio); assert.match(r.j.correio.name, /-editado\.html$/);
  // "Tá bom mas está sem as cores": sem anexo, logo depois da entrega (até no modo Code), o ajuste é no arquivo entregue.
  plan = { formato: 'html', nome: 'x', titulo: 'Galeria', conteudo: '<!doctype html><h1 style="color:red">PADARIA</h1>', projeto: 'Padaria Pão Quente', nota: 'cores', fala: 'Cores aplicadas.' };
  r = await post('/api/chat', { text: 'Tá bom mas está sem as cores coloca as cores', mode: 'code' });
  a = asks.at(-1);
  assert.match(a.sys, /pediu uma alteração/); assert.match(a.text, /galeria-padaria-editado\.html/);
  assert.ok(r.j.correio, 'entregue no correio'); assert.ok(!r.j.written, 'não mexeu no projeto do VS Code');
  // Pelo contexto (a IA decide), sem nenhuma palavra da lista: "ficou sem graça, capricha mais" = editar o último entregue.
  decision = { acao: 'editar', arquivo: 'ultimo' };
  r = await post('/api/chat', { text: 'ficou sem graça, capricha mais' });
  const cls = asks.findLast(x => x.sys.includes('CLASSIFICADOR'));
  assert.match(cls.text, /Último arquivo que o Jarvis entregou no correio: "galeria-padaria-editado/); assert.match(cls.text, /ficou sem graça/);
  assert.match(asks.at(-1).sys, /pediu uma alteração/); assert.ok(r.j.correio, 'editado e entregue');
  // A IA diz que é conversa: nada de arquivo, mesmo com "faz" e "pdf" na frase.
  decision = { acao: 'conversa', arquivo: 'nenhum' };
  r = await post('/api/chat', { text: 'você faz pdf de quantas páginas no máximo?' });
  assert.ok(!r.j.correio, 'pergunta não vira arquivo'); assert.equal(r.j.intro, 'Vi tudo, senhor.');
  decision = null;

  // 6. Ajustes > Projetos.
  const pj = (await get('/api/projects')).projects;
  assert.equal(pj.length, 1); assert.ok(pj[0].notes.some(n => /logo é vermelho/.test(n.t))); assert.ok(pj[0].files.length >= 3);
  assert.ok(!JSON.stringify(pj).includes(OUTDIR.replace(/\\/g, '\\\\')), 'o caminho no disco não vai para a página');
  assert.equal((await post(`/api/projects/${pj[0].id}/notes`, { t: 'prazo: sexta' })).status, 200);
  assert.equal((await post('/api/projects', { name: 'x' })).status, 400);
  assert.equal((await fetch(`${B}/api/projects/${pj[0].id}`, { method: 'DELETE', headers: { 'x-jarvis': '1' } })).status, 200);
  assert.equal((await get('/api/projects')).projects.length, 0);

  // 7. PDF: componentes com classe permitida, imagem só por anexo:N, nada de URL.
  const ph = fm.pdfHtml('Cardápio', '<div class="capa" onclick="x"><h1>Cardápio</h1></div><div class="cards evil"><div class="card"><img src="anexo:1"><h3>Pão</h3></div></div><img src="https://x/y.png"><figure><img src="anexo:2"></figure>', 'verde', [{ name: 'a', data: jpg(1) }]);
  assert.match(ph, /<div class="capa"><h1>/); assert.match(ph, /<div class="cards evil">/, 'no PDF a IA usa classes dela'); assert.ok(!/onclick|https:\/\/x/.test(ph));
  assert.equal((ph.match(/src="data:image\/jpeg/g) || []).length, 1, 'anexo:1 embutido; anexo:2 não existe e sai');
  assert.match(ph, /--c1:#1f7a52/, 'tema verde');
  assert.equal(fm.detect('faz um resumo desse site pra mim', false), null, 'resumo de site é conversa');
  assert.equal(fm.detect('cria um site para a padaria', false), 'criar');
  assert.equal(fm.detect('escreve um script python que renomeia fotos', false), 'criar');
  assert.equal(fm.detect('faz um cardápio bonito com essas fotos', true), 'criar');
  assert.equal(fm.detect('consegue refazer esse PDF', true), 'editar');
  assert.equal(fm.isFollowUpEdit('coloca as cores'), true);
  for (const t of ['coloca uma música', 'deixa o volume no máximo', 'manda um email pra ana']) assert.equal(fm.isFollowUpEdit(t), false, t);
  console.log('arquivos: todos os anexos, imagens no arquivo, só escrever e entregar, memória de projetos e PDF seguro ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  for (const d of [DIR, OUTDIR]) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(0);
