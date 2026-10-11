// Servidores MCP (stdio e HTTP) e o modo de jogar em segundo plano.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-'));
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR });
const mcp = await import('../lib/mcp.js');
const game = await import('../lib/gameplay.js');
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-fake.mjs');

try {
  // Cadastro: validações.
  assert.throws(() => mcp.cleanServer({ name: 'Nome Com Espaço!!' }), /Nome inválido/);
  assert.throws(() => mcp.cleanServer({ name: 'x', command: 'npx & del' }), /só o programa/);
  assert.throws(() => mcp.cleanServer({ name: 'x', type: 'http', url: 'http://exemplo.com/mcp' }), /https/);
  assert.throws(() => mcp.cleanServer({ name: 'x', type: 'http', url: 'https://u:p@exemplo.com/mcp' }), /usuário e senha/);
  assert.deepEqual(mcp.splitArgs(`-y pacote "C:\\Meus Projetos" 'a b'`), ['-y', 'pacote', 'C:\\Meus Projetos', 'a b']);
  assert.deepEqual(mcp.parsePairs('TOKEN=abc=1\nlixo\n X = y '), { TOKEN: 'abc=1', X: 'y' });

  // stdio: conecta, lista, chama; o que altera fica bloqueado até liberar.
  mcp.add({ name: 'teste', command: process.execPath, args: [FAKE], env: 'SEGREDO_TESTE=valor-muito-secreto' });
  await mcp.refresh('teste');
  let st = mcp.status()[0];
  assert.equal(st.state, 'conectado', st.error); assert.equal(st.tools.length, 2); assert.equal(st.server, 'falso');
  assert.ok(!JSON.stringify(mcp.status()).includes('valor-muito-secreto'), 'segredo nunca vai para a página');
  assert.ok(!fs.readFileSync(path.join(DIR, 'mcp.json'), 'utf8').includes('"tools"'));
  const cat = mcp.catalog();
  assert.ok(cat.some(l => l.startsWith('teste/eco(texto:string) [só leitura]')));
  assert.ok(cat.some(l => l.startsWith('teste/apagar(id?:string) [altera coisas, BLOQUEADA]')));
  let r = await mcp.callTool('teste', 'eco', { texto: 'oi' });
  assert.equal(r.ok, true); assert.equal(r.text.trim(), 'eco: oi com-env');
  await assert.rejects(mcp.callTool('teste', 'eco', {}), /Falta o argumento "texto"/);
  await assert.rejects(mcp.callTool('teste', 'apagar', { id: '1' }), e => e.code === 403);
  await assert.rejects(mcp.callTool('teste', 'naoexiste', {}), e => e.code === 404);
  await assert.rejects(mcp.callTool('outro', 'eco', {}), e => e.code === 404);
  mcp.setFlag('teste', 'write', true);
  assert.equal((await mcp.callTool('teste', 'apagar', { id: '1' })).text, 'apagado');
  mcp.setFlag('teste', 'enabled', false);
  await assert.rejects(mcp.callTool('teste', 'eco', { texto: 'x' }), /desligado/);
  assert.equal(mcp.status()[0].state, 'desligado');
  mcp.remove('teste'); assert.equal(mcp.status().length, 0);

  // Programa que não existe: erro amigável, sem derrubar nada.
  mcp.add({ name: 'quebrado', command: 'programa-que-nao-existe-123', args: '' });
  await mcp.refresh('quebrado');
  assert.equal(mcp.status()[0].state, 'erro');
  mcp.remove('quebrado');

  // HTTP (Streamable HTTP): resposta em SSE, sessão pelo cabeçalho, token no cabeçalho.
  let sawAuth = false, sawSession = false;
  const srv = http.createServer((q, s) => {
    let body = ''; q.on('data', d => body += d); q.on('end', () => {
      if (q.method === 'DELETE') { s.writeHead(204); return s.end(); }
      if (q.headers.authorization === 'Bearer tok-12345678') sawAuth = true;
      const m = JSON.parse(body);
      if (m.method !== 'initialize' && q.headers['mcp-session-id'] === 'sess-1') sawSession = true;
      if (m.id == null) { s.writeHead(202); return s.end(); }
      const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'web' } }
        : m.method === 'tools/list' ? { tools: [{ name: 'hora', description: 'Hora', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
        : { content: [{ type: 'text', text: '12:00' }] };
      s.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
      s.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  mcp.add({ name: 'web', type: 'http', url: `http://localhost:${srv.address().port}/mcp`, headers: 'Authorization: Bearer tok-12345678' });
  await mcp.refresh('web');
  assert.equal(mcp.status()[0].state, 'conectado', mcp.status()[0].error);
  assert.equal((await mcp.callTool('web', 'hora', {})).text, '12:00');
  assert.ok(sawAuth && sawSession);
  assert.ok(mcp.status()[0].secrets[0].startsWith('Authorization ••••'));
  mcp.closeAll(); srv.close();

  // Jogo: teclas que o usuário citou, ritmo, validação da jogada.
  assert.deepEqual(game.keysFrom('pode jogar esse jogo pra mim no WASD e no espaço pra pular'), ['w', 'a', 's', 'd', 'space']);
  assert.deepEqual(game.keysFrom('joga pra mim usando as setas'), ['up', 'down', 'left', 'right']);
  assert.deepEqual(game.keysFrom('joga pra mim'), ['w', 'a', 's', 'd', 'space']);
  assert.ok(game.keysFrom('joga pra mim no wasd e a tecla e pra interagir').includes('e'));
  assert.equal(game.everyFrom('joga a 1 fps'), 1000);
  assert.equal(game.everyFrom('uma jogada a cada 5 segundos'), 5000);
  assert.equal(game.everyFrom('a 50 fps'), 1000, 'nunca mais rápido que 1 por segundo');
  assert.equal(game.everyFrom('joga'), 2000);
  const mv = game.cleanMove({ teclas: ['d', 'espaço', 'ctrl', 'f4', 'd'], ms: 99999 }, ['w', 'a', 's', 'd', 'space']);
  assert.deepEqual(mv.teclas, ['d', 'space']); assert.equal(mv.ms, 1500);
  for (const t of ['pode jogar esse jogo pra mim no WASD e no espaço pra pular', 'joga esse jogo pra mim']) assert.ok(game.GAME_RX.test(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), t);
  assert.ok(!game.GAME_RX.test('qual jogo voce gosta'));
  for (const t of ['para de jogar', 'chega de jogar', 'para', 'jarvis para']) assert.ok(game.STOP_RX.test(t), t);

  // Laço: joga, respeita o ritmo, para quando pedido; e para sozinho se a janela mudar.
  const acts = []; let clock = 0, ended = null;
  const deps = { now: () => clock, nap: async ms => { clock += ms; await new Promise(ok => setImmediate(ok)); },
    capture: async () => ({ id: 'c', image: 'data:image/jpeg;base64,AA==' }),
    decide: async () => ({ teclas: ['d'], ms: 300 }),
    act: async d => { acts.push(d); clock += 300; return 'ok'; }, onEnd: d => { ended = d; } };
  const s1 = game.start(deps, { request: 'joga pra mim no wasd a cada 3 segundos', profile: null });
  assert.equal(s1.every, 3000); assert.ok(game.running());
  assert.equal(game.start(deps, { request: 'joga', profile: null }).already, true, 'uma partida por vez');
  while (acts.length < 4) await new Promise(ok => setImmediate(ok));
  game.stop('pedido');
  while (!ended) await new Promise(ok => setImmediate(ok));
  assert.equal(ended.why, 'pedido'); assert.ok(!game.running());
  assert.equal(acts[0].inicio, true); assert.equal(acts[1].inicio, undefined, 'só a 1ª jogada marca a janela do jogo');
  assert.equal(acts[0].acao, 'segurar'); assert.equal(acts[0].teclas, 'd');
  assert.ok(clock >= 3000 * 3, 'uma jogada a cada 3 s');
  ended = null;
  game.start({ ...deps, act: async () => 'nao_permitido' }, { request: 'joga pra mim', profile: null });
  while (!ended) await new Promise(ok => setImmediate(ok));
  assert.equal(ended.why, 'janela');
  assert.match(game.endSay(ended, null), /janela da frente mudou/);
  console.log('mcp: stdio, http, permissões, segredos e jogo em segundo plano ok');
} finally { mcp.closeAll(); }
