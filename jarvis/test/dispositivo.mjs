// Arquivos do computador (Gemini falso, pastas falsas): criar arquivo onde você pediu (e no correio), site com várias
// páginas escrito arquivo por arquivo, e gerenciar (listar, criar pasta, mover, renomear, Lixeira só com confirmação),
// sem nunca sair das pastas do usuário, sobrescrever, ou criar executável.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dev-'));
const HOME = path.join(DIR, 'home'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'fora-dev-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
// A pasta temporária do Windows fica dentro de AppData (bloqueada de propósito): no teste, o AppData aponta para outro lugar.
process.env.LOCALAPPDATA = path.join(DIR, 'fake-local'); process.env.APPDATA = path.join(DIR, 'fake-roaming');
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: path.join(DIR, 'data'), PORT: String(PORT), GEMINI_API_KEY: 'fakeGeminiKey-dispositivo-1' });
for (const k of ['GEMINI_API_KEY_2', 'GEMINI_API_KEY_PAGO', 'ANTHROPIC_API_KEY']) delete process.env[k];
const P = { desktop: path.join(HOME, 'Desktop'), documentos: path.join(HOME, 'Documents'), downloads: path.join(HOME, 'Downloads'), imagens: path.join(HOME, 'Pictures'), musicas: path.join(HOME, 'Music'), videos: path.join(HOME, 'Videos') };
for (const d of Object.values(P)) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(P.downloads, 'conta-luz.pdf'), '%PDF luz');
fs.writeFileSync(path.join(P.downloads, 'conta-agua.pdf'), '%PDF agua');
fs.writeFileSync(path.join(P.desktop, 'teste.txt'), 'apagar');
fs.writeFileSync(path.join(P.desktop, 'Discord.lnk'), 'atalho');
fs.writeFileSync(path.join(OUT, 'segredo.txt'), 'nao mexer');

// Gemini falso: classificador, planejador de operações, plano de arquivo e cada arquivo do site.
let decision = null, ops = null, plan = null;
const asks = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, opt);
  const body = JSON.parse(opt.body), sys = body.systemInstruction?.parts?.[0]?.text || '', text = body.contents.at(-1).parts[0].text;
  asks.push({ sys, text, max: body.generationConfig?.maxOutputTokens });
  let out;
  if (sys.includes('CLASSIFICADOR DE PEDIDOS')) out = JSON.stringify(decision);
  else if (sys.includes('cuida dos arquivos e pastas')) out = JSON.stringify(ops);
  else if (sys.includes('vai produzir um ARQUIVO')) out = JSON.stringify(plan);
  else if (sys.includes('UM arquivo de um site')) { const f = text.match(/Escreva agora: (\S+)/)[1]; out = f.endsWith('.css') ? '```css\n.topo{color:#a33}\n```' : f.endsWith('.js') ? 'console.log("oi")' : `<!doctype html><title>${f}</title><link rel="stylesheet" href="css/estilo.css"><img src="img/anexo-1.jpg">`; }
  else out = JSON.stringify({ intro: 'Certo, senhor.', slides: [], outro: '' });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const dev = await import('../lib/devicefiles.js');
dev.DEV.places = () => P;
const trashed = []; dev.DEV.trash = async list => { trashed.push(...list); for (const f of list) fs.rmSync(f, { recursive: true, force: true }); return list; };
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

try {
  await post('/api/profile', { name: 'Ana', address: 'senhor', city: { name: 'Jundiaí', latitude: -23.18, longitude: -46.89, timezone: 'America/Sao_Paulo' }, lang: 'pt-BR' });

  // 1. Regras de caminho.
  for (const bad of ['../fora.txt', '..\\fora.txt', '.git/x', 'a/../../b', 'CON', 'nul.txt', 'a:b.txt', 'x/y/z/w/v/u.txt']) assert.throws(() => dev.resolve('desktop', bad), bad);
  assert.throws(() => dev.resolve('C:\\Windows', 'x'), /Não conheço o lugar/);
  assert.equal(dev.placeOf('Área de Trabalho'), 'desktop'); assert.equal(dev.placeOf('meus downloads'), 'downloads'); assert.equal(dev.placeOf(''), 'jarvis');
  assert.equal(dev.pretty(path.join(P.desktop, 'Jarvis', 'x')), 'Área de Trabalho\\Jarvis\\x');
  // Junção que leva para fora: recusada.
  let junction = false;
  try { fs.symlinkSync(OUT, path.join(P.desktop, 'atalho'), 'junction'); junction = true; } catch { /* sem permissão: pula */ }
  if (junction) { assert.throws(() => dev.resolve('desktop', 'atalho/segredo.txt'), /Fora/); assert.throws(() => dev.writeFile('desktop', 'atalho/novo.txt', 'x'), /Fora/); fs.rmSync(path.join(P.desktop, 'atalho')); }
  // Nunca sobrescreve; executável não é criado.
  const w1 = dev.writeFile('documentos', 'Notas/a.txt', '1'), w2 = dev.writeFile('documentos', 'Notas/a.txt', '2');
  assert.notEqual(w1, w2); assert.equal(fs.readFileSync(w1, 'utf8'), '1'); assert.match(w2, /a \(2\)\.txt$/);
  for (const x of ['virus.exe', 'run.bat', 'x.lnk', 'a.reg', 'b.ps1', 'c.vbs', 'd.hta']) assert.throws(() => dev.writeFile('desktop', x, 'x'), x);
  assert.throws(() => dev.checkAbs(path.join(OUT, 'segredo.txt')), /Fora/);
  assert.throws(() => dev.checkAbs(P.desktop), /Fora/, 'o lugar inteiro não');

  // 2. "Cria um PDF/arquivo na pasta Orçamentos dos documentos": vai para lá E para o correio.
  decision = { acao: 'criar', arquivo: 'nenhum' };
  plan = { formato: 'md', nome: 'orcamento festa', titulo: 'Orçamento', conteudo: '# Orçamento\n- bolo', destino: { lugar: 'documentos', pasta: 'Orçamentos/2026' }, projeto: 'Festa', nota: 'orçamento', fala: 'Pronto.' };
  let r = await post('/api/chat', { text: 'cria um orçamento da festa numa pasta Orçamentos/2026 nos documentos' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.ok(fs.existsSync(path.join(P.documentos, 'Orçamentos', '2026', 'orcamento-festa.md')), 'salvo onde pediu');
  assert.ok(r.j.correio, 'e no correio'); assert.match(r.j.intro, /Salvei em Documentos\\Orçamentos\\2026/);
  // Sem destino: a pasta Jarvis na Área de Trabalho.
  plan = { ...plan, nome: 'lista', destino: undefined };
  r = await post('/api/chat', { text: 'cria uma lista de convidados' });
  assert.ok(fs.existsSync(path.join(P.desktop, 'Jarvis', 'lista.md'))); assert.ok(r.j.correio);
  // Destino estranho da IA ("../.." ou lugar de sistema): cai na pasta padrão, nunca fora.
  plan = { ...plan, nome: 'esperto', destino: { lugar: 'C:\\Windows', pasta: '../../System32' } };
  r = await post('/api/chat', { text: 'cria um arquivo esperto' });
  assert.ok(fs.existsSync(path.join(P.desktop, 'Jarvis', 'esperto.md')), 'destino inválido -> pasta padrão');
  // Script de dois cliques vira .txt.
  plan = { formato: 'bat', nome: 'limpa', titulo: 'x', conteudo: 'del *.*', projeto: 'x', nota: 'x', fala: 'x' };
  r = await post('/api/chat', { text: 'cria um bat que limpa a pasta' });
  assert.ok(fs.existsSync(path.join(P.desktop, 'Jarvis', 'limpa.bat.txt')), '.bat não é criado como .bat');

  // 3. Site com várias páginas: planejado, cada arquivo numa chamada (24 mil tokens cada), pasta + .zip no correio.
  const img = (await post('/api/files', { name: 'logo.jpg', type: 'image/jpeg', data: jpg })).j;
  plan = { formato: 'site', nome: 'padaria site', titulo: 'Padaria', conteudo: 'Paleta #a33 e creme; fonte Georgia; menu fixo.', destino: { lugar: 'area de trabalho', pasta: 'Sites' },
    arquivos: [{ caminho: 'index.html', descricao: 'início' }, { caminho: 'cardapio.html', descricao: 'cardápio' }, { caminho: 'css/estilo.css', descricao: 'estilos' }, { caminho: 'js/app.js', descricao: 'menu' }, { caminho: '../fora.html', descricao: 'x' }, { caminho: 'virus.exe', descricao: 'x' }],
    projeto: 'Padaria', nota: 'site em 4 arquivos', fala: 'O site está pronto.' };
  const n0 = asks.length;
  r = await post('/api/chat', { text: 'cria um site da padaria com várias páginas na área de trabalho, numa pasta Sites', files: [img.id] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const site = path.join(P.desktop, 'Sites', 'padaria-site');
  for (const f of ['index.html', 'cardapio.html', 'css/estilo.css', 'js/app.js', 'img/anexo-1.jpg']) assert.ok(fs.existsSync(path.join(site, f)), f);
  assert.ok(!fs.existsSync(path.join(P.desktop, 'Sites', 'fora.html')) && !fs.existsSync(path.join(site, 'virus.exe')), 'caminhos ruins da IA ficam de fora');
  const files = asks.slice(n0).filter(x => x.sys.includes('UM arquivo de um site'));
  assert.equal(files.length, 4, 'um pedido por arquivo'); assert.ok(files.every(x => x.max === 24000));
  assert.match(files[0].text, /Escreva agora: css\/estilo\.css/, 'o CSS primeiro');
  assert.match(files[1].text, /\.topo\{color:#a33\}/, 'as páginas veem o CSS já escrito');
  assert.equal(fs.readFileSync(path.join(site, 'css', 'estilo.css'), 'utf8'), '.topo{color:#a33}\n', 'sem cercas ```');
  assert.match(r.j.correio.name, /^padaria-site\.zip$/); assert.equal(r.j.site.arquivos, 4);
  assert.match(r.j.intro, /O site está na pasta Área de Trabalho\\Sites\\padaria-site/);
  const zip = fs.readFileSync(path.join(P.desktop, 'Jarvis', 'correio', 'padaria-site.zip'));
  assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.ok(zip.includes('padaria-site/css/estilo.css') && zip.includes('padaria-site/img/anexo-1.jpg'));

  // 4. Gerenciar: listar, criar pasta, mover, renomear (na hora); Lixeira só com confirmação; nada fora.
  decision = { acao: 'gerenciar', arquivo: 'nenhum' };
  ops = { fala: 'Organizando, senhor.', ops: [
    { op: 'criar_pasta', lugar: 'documentos', caminho: 'Contas' },
    { op: 'mover', de: { lugar: 'downloads', caminho: 'conta-luz.pdf' }, para: { lugar: 'documentos', caminho: 'Contas' } },
    { op: 'mover', de: { lugar: 'downloads', caminho: 'conta-agua.pdf' }, para: { lugar: 'downloads', caminho: 'agua-outubro.pdf' } },
    { op: 'mover', de: { lugar: 'desktop', caminho: 'Discord.lnk' }, para: { lugar: 'documentos', caminho: 'Contas' } },
    { op: 'mover', de: { lugar: 'downloads', caminho: 'agua-outubro.pdf' }, para: { lugar: 'downloads', caminho: 'agua.exe' } },
    { op: 'mover', de: { lugar: 'desktop', caminho: '../../' + path.basename(OUT) + '/segredo.txt' }, para: { lugar: 'desktop', caminho: 'x.txt' } },
    { op: 'listar', lugar: 'documentos', caminho: 'Contas' },
    { op: 'lixeira', lugar: 'desktop', caminho: 'teste.txt' },
    { op: 'lixeira', lugar: 'desktop', caminho: '' }] };
  r = await post('/api/chat', { text: 'organiza: cria uma pasta Contas nos documentos, move as contas dos downloads pra lá e apaga o teste.txt da área de trabalho' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const planner = asks.findLast(x => x.sys.includes('cuida dos arquivos e pastas'));
  assert.match(planner.text, /conta-luz\.pdf/, 'a IA vê o que existe'); assert.match(planner.text, /teste\.txt/);
  assert.ok(fs.existsSync(path.join(P.documentos, 'Contas', 'conta-luz.pdf')), 'movido');
  assert.ok(fs.existsSync(path.join(P.downloads, 'agua-outubro.pdf')), 'renomeado');
  assert.ok(fs.existsSync(path.join(P.documentos, 'Contas', 'Discord.lnk')), 'atalho que já existe pode ser movido');
  assert.ok(!fs.existsSync(path.join(P.downloads, 'agua.exe')), 'renomear para .exe não');
  assert.equal(fs.readFileSync(path.join(OUT, 'segredo.txt'), 'utf8'), 'nao mexer', 'fora das pastas: nada');
  assert.match(r.j.intro, /criei a pasta Documentos\\Contas/); assert.match(r.j.intro, /Documentos\\Contas \(2 itens\)/); assert.match(r.j.intro, /Não deu:/);
  assert.ok(fs.existsSync(path.join(P.desktop, 'teste.txt')), 'Lixeira só depois de confirmar');
  assert.equal(r.j.action.kind, 'files_trash'); assert.equal(r.j.action.params.paths.length, 1, 'o lugar inteiro não entra');
  // Confirmar pelo botão: vai para a Lixeira.
  const c = await post(`/api/actions/${r.j.action.id}/confirm`, { via: 'touch' });
  assert.equal(c.status, 200, JSON.stringify(c.j)); assert.deepEqual(c.j.trashed, ['teste.txt']);
  assert.deepEqual(trashed, [path.join(P.desktop, 'teste.txt')]);
  // Por voz também ("confirmo"), e o cancelar não apaga.
  fs.writeFileSync(path.join(P.desktop, 'velho.txt'), 'x');
  ops = { fala: 'Certo.', ops: [{ op: 'lixeira', lugar: 'area de trabalho', caminho: 'velho.txt' }] };
  r = await post('/api/chat', { text: 'apaga o velho.txt da área de trabalho' });
  assert.match(r.j.intro, /Diga "confirmo"/);
  r = await post('/api/chat', { text: 'confirmo' });
  assert.match(r.j.intro, /Mandei velho\.txt para a Lixeira/); assert.ok(!fs.existsSync(path.join(P.desktop, 'velho.txt')));
  console.log('dispositivo: criar onde pediu + correio, site arquivo por arquivo, gerenciar com Lixeira confirmada e travas de caminho ok');
} finally {
  server.close(); globalThis.fetch = realFetch;
  for (const d of [DIR, OUT]) fs.rmSync(d, { recursive: true, force: true });
}
process.exit(0);
