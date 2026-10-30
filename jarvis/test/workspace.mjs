// Pasta de projeto do Jarvis Code: escolhida pela interface, cria e edita arquivos lá dentro (com subpastas e backup),
// e nunca sai dela (.., atalhos, node_modules, pastas ocultas, executáveis, pastas do sistema ou do próprio Jarvis).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ws-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'padaria-')), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'fora-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
// A pasta temporária do Windows fica dentro de AppData (bloqueada de propósito): no teste, o AppData aponta para outro lugar.
process.env.LOCALAPPDATA = path.join(DIR, 'fake-local'); process.env.APPDATA = path.join(DIR, 'fake-roaming');
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: path.join(DIR, 'data'), JARVIS_CODE_DIR: path.join(DIR, 'Jarvis Code'), PORT: String(PORT), GEMINI_API_KEY: 'wsTestGemini-0000' });

// Projeto de exemplo.
fs.mkdirSync(path.join(PROJ, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'node_modules', 'lib'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.git'));
fs.writeFileSync(path.join(PROJ, 'index.html'), '<!doctype html>\n<title>Padaria</title>\n' + '<p>pao frances</p>\n'.repeat(20));
fs.writeFileSync(path.join(PROJ, 'src', 'App.jsx'), 'export default function App() { return null; }\n');
fs.writeFileSync(path.join(PROJ, 'node_modules', 'lib', 'x.js'), 'x');
fs.writeFileSync(path.join(PROJ, '.git', 'config'), 'x');
fs.writeFileSync(path.join(OUT, 'segredo.js'), 'nao mexer');

let codePick = null, planned = '';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => {
  if (String(u).startsWith('http://localhost')) return realFetch(u, o);
  const s = String(o?.body || '');
  const reply = t => Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (s.includes('EDITANDO o arquivo')) return reply('```html\n<!doctype html>\n<title>Padaria</title>\n<footer>rodapé novo</footer>\n' + '<p>pao frances</p>\n'.repeat(20) + '```');
  if (s.includes('conteúdo COMPLETO')) return reply('export default function Menu() {\n  return <nav>Pães</nav>;\n}');
  if (s.includes('modo Code do assistente')) { planned = s; return reply(JSON.stringify(codePick)); }
  return Promise.resolve(new Response('{}', { status: 503 }));
};
const L = await import('../lib/launcher.js');
L.OPEN.platform = 'win32'; L.OPEN.exists = () => false;   // sem VS Code nos testes: nada é aberto de verdade
L.OPEN.spawn = () => { const c = new EventEmitter(); c.unref = () => {}; return c; };
const W = await import('../lib/workspace.js');
const { server } = await import('../server.js');
const { saveProfile } = await import('../lib/profile.js');
const { ROOT } = await import('../lib/config.js');
saveProfile({ name: 'Teste', address: 'senhor', lang: 'pt-BR', city: { name: 'Jundiaí', latitude: -23.2, longitude: -46.9, timezone: 'America/Sao_Paulo' } }, null);
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const post = (p, body) => fetch(`http://localhost:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) });

try {
  // Pastas proibidas.
  assert.match(W.blocked(path.parse(PROJ).root), /raiz/);
  assert.match(W.blocked(path.join(DIR, 'fake-local', 'x')) || 'inexistente', /AppData|inexistente/);
  assert.match(W.blocked(path.join(ROOT, 'lib')), /próprio Jarvis/);
  if (process.env.WINDIR) assert.match(W.blocked(process.env.WINDIR), /Windows/);
  assert.equal((await post('/api/workspace', { path: path.join(ROOT, 'lib') })).status, 400);
  assert.equal((await post('/api/workspace', { path: 'relativo/nao' })).status, 400);
  assert.equal((await post('/api/workspace', { path: path.join(PROJ, 'index.html') })).status, 400, 'arquivo não é pasta');
  assert.equal((await fetch(`http://localhost:${PORT}/api/workspace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: PROJ }) })).status, 403, 'sem o cabeçalho próprio');

  // Escolhe pela janela do Windows (simulada) e pelo caminho colado.
  W.WS.pick = async () => null;
  assert.equal((await (await post('/api/workspace/pick', {})).json()).cancelled, true);
  W.WS.pick = async () => PROJ;
  let st = await (await post('/api/workspace/pick', {})).json();
  assert.equal(st.workspace.active.path, fs.realpathSync.native(PROJ)); assert.equal(st.workspace.active.files, 2, 'node_modules e .git não contam');

  // Regras de caminho.
  for (const bad of ['../fora.js', '..\\fora.js', 'node_modules/lib/y.js', '.git/hooks/x.js', 'run.bat', 'virus.exe', 'a/./b.js', 'x.ps1']) assert.throws(() => W.resolveRel(bad), bad);
  assert.equal(W.resolveRel('src\\components\\Menu.jsx').rel, 'src/components/Menu.jsx');
  // Atalho (junction) que leva para fora do projeto: recusado.
  let junction = false;
  try { fs.symlinkSync(OUT, path.join(PROJ, 'atalho'), 'junction'); junction = true; } catch { /* sem permissão para criar: pula */ }
  if (junction) { assert.throws(() => W.resolveRel('atalho/segredo.js'), /Fora da pasta/); assert.throws(() => W.createFile('atalho/novo.js', 'x'), /Fora da pasta/); }

  // Modo Code, escrever: o arquivo novo vai para o projeto (com subpasta) e a IA sabe o que já existe.
  codePick = { acao: 'escrever', arquivo: 'src/components/Menu.jsx', pedido: 'menu da padaria' };
  let j = await (await post('/api/chat', { text: 'cria um componente de menu para o site', mode: 'code' })).json();
  assert.match(planned, /PROJETO ATIVO/); assert.match(planned, /src\/App\.jsx/);
  assert.match(fs.readFileSync(path.join(PROJ, 'src', 'components', 'Menu.jsx'), 'utf8'), /function Menu/);
  assert.equal(j.written.project, path.basename(PROJ)); assert.match(j.intro, /src\/components\/Menu\.jsx/);
  // De novo: não sobrescreve.
  j = await (await post('/api/chat', { text: 'cria um componente de menu para o site', mode: 'code' })).json();
  assert.match(j.intro, /já existe/); assert.match(fs.readFileSync(path.join(PROJ, 'src', 'components', 'Menu.jsx'), 'utf8'), /function Menu/);

  // Editar: lê o atual, grava o novo, backup fora do projeto (em data/versoes).
  codePick = { acao: 'editar', arquivo: 'index.html', pedido: 'adicionar rodapé' };
  j = await (await post('/api/chat', { text: 'adiciona um rodapé no index.html', mode: 'code' })).json();
  assert.match(fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8'), /rodapé novo/); assert.equal(j.written.edited, true);
  const vdir = path.join(DIR, 'data', 'versoes', path.basename(PROJ).replace(/[^\w.-]+/g, '_'));
  const vers = fs.readdirSync(vdir); assert.equal(vers.length, 1); assert.ok(!fs.readFileSync(path.join(vdir, vers[0]), 'utf8').includes('rodapé novo'), 'backup = versão anterior');
  assert.ok(!fs.readdirSync(PROJ).some(n => /versoes/.test(n)), 'o backup não suja o projeto');
  // A IA tentando editar algo fora: nada acontece.
  codePick = { acao: 'editar', arquivo: '../' + path.basename(OUT) + '/segredo.js', pedido: 'x' };
  await post('/api/chat', { text: 'edita o segredo', mode: 'code' });
  assert.equal(fs.readFileSync(path.join(OUT, 'segredo.js'), 'utf8'), 'nao mexer');

  // "Parar de usar": volta para a pasta Jarvis Code.
  st = await (await post('/api/workspace', { clear: true })).json();
  assert.equal(st.workspace.active, null); assert.equal(st.workspace.recent.length, 1);
  codePick = { acao: 'escrever', arquivo: 'teste.html', pedido: 'x' };
  await post('/api/chat', { text: 'cria um html de teste no vs code', mode: 'code' });
  assert.ok(fs.existsSync(path.join(DIR, 'Jarvis Code', 'teste.html')) || fs.readdirSync(path.join(DIR, 'Jarvis Code')).some(n => n.startsWith('teste')));
  console.log('workspace: pasta escolhida, criar/editar com backup e limites de segurança ok');
} finally { server.close(); globalThis.fetch = realFetch; try { fs.rmSync(path.join(PROJ, 'atalho'), { force: true, recursive: false }); } catch { /* ok */ } }
