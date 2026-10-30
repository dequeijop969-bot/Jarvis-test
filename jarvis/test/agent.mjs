// Modo Code, tarefas de vários passos (lib/agent.js): validação dos passos da IA e o ciclo olhar → decidir → agir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JARVIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-'));
const { cleanStep, typedFromRequest, runTask, AGENT, KEYS } = await import('../lib/agent.js');
Object.assign(AGENT, { settle: 0, openSettle: 0 });
const REQ = 'Jarvis no meu segundo monitor abra o discord e entre na chamada do servidor Sei lá';
const profile = { name: 'Teste', address: 'senhor', lang: 'pt-BR' };

// Digitar: só o que o usuário falou (sem acento/maiúscula importar). Texto lido da tela ou inventado vira desistência.
assert.ok(typedFromRequest('sei la', REQ)); assert.ok(typedFromRequest('Sei lá', REQ));
assert.ok(!typedFromRequest('Sei', 'Seila')); assert.ok(!typedFromRequest('format c:', REQ));
assert.deepEqual(cleanStep({ acao: 'digitar', texto: 'Sei lá', enter: true }, REQ), { pensamento: '', fala: '', acao: 'digitar', texto: 'Sei lá', enter: true });
assert.equal(cleanStep({ acao: 'digitar', texto: 'del /s /q C:\\' }, REQ).acao, 'desistir', 'texto que o usuário não disse não é digitado');
// Teclas: só da lista fixa.
assert.equal(cleanStep({ acao: 'tecla', tecla: 'Ctrl+K' }, REQ).tecla, 'ctrl+k');
for (const bad of ['alt+f4', 'win+r', 'delete', 'ctrl+w']) assert.throws(() => cleanStep({ acao: 'tecla', tecla: bad }, REQ));
assert.ok(!KEYS.some(k => /win|alt\+f4|delete/.test(k)));
// Clicar: caixa 0–1000 válida → centro; clique duplo só se pedido.
assert.deepEqual(cleanStep({ acao: 'clicar', box_2d: [100, 200, 300, 400], alvo: 'Geral' }, REQ), { pensamento: '', fala: '', acao: 'clicar', y: 200, x: 300, duplo: false, alvo: 'Geral' });
assert.equal(cleanStep({ acao: 'clicar', box_2d: [100, 200, 300, 400], duplo: true }, REQ).duplo, true);
assert.throws(() => cleanStep({ acao: 'clicar', box_2d: [300, 200, 100, 400] }, REQ));
assert.throws(() => cleanStep({ acao: 'clicar', box_2d: [0, 0, 10, 2000] }, REQ));
assert.throws(() => cleanStep({ acao: 'rodar_comando', cmd: 'x' }, REQ));
assert.equal(cleanStep({ acao: 'esperar', segundos: 99 }, REQ).segundos, 5);

// Ciclo completo com dependências falsas: abre o Discord no monitor 2, Ctrl+K, digita o servidor, clica no canal de voz, confere e conclui.
function fake(steps, results = {}) {
  const sent = [], caps = [], opened = [];
  let n = 0, t = 0;
  return { sent, caps, opened, deps: {
    now: () => (t += 1000), sleep: async () => {},
    capture: async mon => { caps.push(mon); return { id: `cap${++n}`.padEnd(12, '0'), image: 'data:image/jpeg;base64,AA==', janela: 'monitor 2' }; },
    decide: async ({ content }) => { const s = steps.shift(); assert.ok(s, `passo extra pedido: ${content}`); return cleanStep(s, REQ); },
    act: async data => { sent.push(data); return results[data.acao] || 'ok'; },
    open: async (name, mon) => { opened.push([name, mon]); return { ok: true, label: 'o Discord' }; }
  } };
}
let f = fake([
  { pensamento: 'Discord aberto; Ctrl+K busca servidores', acao: 'tecla', tecla: 'ctrl+k' },
  { acao: 'digitar', texto: 'Sei lá', enter: true },
  { pensamento: 'canal de voz Geral à esquerda', acao: 'clicar', box_2d: [400, 100, 420, 200], alvo: 'canal de voz Geral' },
  { acao: 'concluido', fala: 'Pronto, senhor: está na call do Sei lá.' }
]);
let r = await runTask(f.deps, { goal: 'entrar no canal de voz do servidor Sei lá', request: REQ, monitor: 2, profile, openFirst: 'discord' });
assert.equal(r.status, 'ok'); assert.match(r.say, /call do Sei lá/);
assert.deepEqual(f.opened, [['discord', 2]]);
assert.deepEqual(f.caps, [2, 2, 2, 2], 'toda foto é do monitor pedido');
assert.deepEqual(f.sent.map(s => s.acao), ['tecla', 'digitar', 'clicar']);
assert.equal(f.sent[1].texto, 'Sei lá'); assert.equal(f.sent[1].enter, true);
assert.deepEqual([f.sent[2].x, f.sent[2].y, f.sent[2].captura], [150, 410, 'cap300000000'], 'o clique aponta dentro da foto daquele passo');

// Sem abrir nem clicar antes, teclado é bloqueado (a janela da frente seria a do próprio Jarvis).
f = fake([{ acao: 'tecla', tecla: 'enter' }, { acao: 'desistir', motivo: 'x', fala: 'Desisto, senhor.' }]);
r = await runTask(f.deps, { goal: 'x', request: REQ, profile });
assert.equal(f.sent.length, 0); assert.equal(r.status, 'desistiu');

// Cancelado pelo usuário (arrastou o Jarvis Code): para na hora.
f = fake([{ acao: 'clicar', box_2d: [1, 1, 2, 2] }, { acao: 'clicar', box_2d: [5, 5, 9, 9] }], { clicar: 'cancelado' });
r = await runTask(f.deps, { goal: 'x', request: REQ, profile });
assert.equal(r.status, 'cancelado'); assert.equal(f.sent.length, 1);

// O mesmo passo 3 vezes seguidas: preso, para.
f = fake(Array.from({ length: 5 }, () => ({ acao: 'rolar', direcao: 'baixo' })));
r = await runTask(f.deps, { goal: 'x', request: REQ, profile });
assert.equal(r.status, 'preso'); assert.equal(f.sent.length, 2);

// Limite de passos.
const max = AGENT.maxSteps; AGENT.maxSteps = 3;
f = fake([{ acao: 'esperar' }, { acao: 'rolar' }, { acao: 'esperar', segundos: 3 }]);
r = await runTask(f.deps, { goal: 'x', request: REQ, profile });
assert.equal(r.status, 'limite'); AGENT.maxSteps = max;

console.log('agent: passos validados e ciclo olhar → decidir → agir ok');
