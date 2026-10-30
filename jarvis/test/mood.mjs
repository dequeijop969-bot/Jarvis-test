// Expressões do Jarvis Code: o que o usuário diz, o resultado do pedido e a marca que a IA põe ao olhar a tela.
import assert from 'node:assert/strict';
const m = await import('../lib/mood.js');

assert.equal(m.fromText('te amo jarvis'), 'apaixonado');
assert.equal(m.fromText('que fofo você'), 'apaixonado');
assert.equal(m.fromText('valeu, mandou bem!'), 'feliz');
assert.equal(m.fromText('Obrigado'), 'feliz');
assert.equal(m.fromText('você é um inútil'), 'bravo');
assert.equal(m.fromText('tchau, vou dormir'), 'triste');
assert.equal(m.fromText('Nossa!'), 'surpreso');
assert.equal(m.fromText('dá um mortal aí'), 'tonto');
assert.equal(m.fromText('abre o youtube'), null);
assert.equal(m.fromText('obrigado, te amo'), 'apaixonado', 'te amo vence obrigado');

assert.equal(m.fromReply({ task: { status: 'ok' } }), 'feliz');
assert.equal(m.fromReply({ task: { status: 'desistiu' } }), 'triste');
assert.equal(m.fromReply({ task: { status: 'preso' } }), 'tonto');
assert.equal(m.fromReply({ task: { status: 'cancelado' } }), null, 'cancelar (arrastar) não é tristeza');
assert.equal(m.fromReply({ mcp: { ok: false } }), 'confuso');
assert.equal(m.fromReply({ written: { name: 'a.html' } }), 'feliz');
assert.equal(m.fromReply({ intro: 'Não consegui entender a ação agora, senhor.' }), 'confuso');
assert.equal(m.fromReply({ intro: 'Às suas ordens.' }), null);

// Tela: a marca sai do texto falado; nome fora da lista é ignorado.
let s = m.splitScreenMood('Vejo uma foto de uma moça sorrindo na praia, senhor. [[emocao:apaixonado]]');
assert.equal(s.mood, 'apaixonado'); assert.equal(s.text, 'Vejo uma foto de uma moça sorrindo na praia, senhor.');
s = m.splitScreenMood('Tela azul, senhor. [[emoção: Triste]]'); assert.equal(s.mood, 'triste'); assert.ok(!s.text.includes('['));
s = m.splitScreenMood('Nada demais. [[emocao:explodir]]'); assert.equal(s.mood, null); assert.equal(s.text, 'Nada demais.');
assert.equal(m.splitScreenMood('Só texto.').mood, null);

// Escolha final: tela > fala > resultado; e a duração.
assert.deepEqual(m.pick('valeu', { emotion: 'triste' }), { nome: 'triste', segundos: 3 });
assert.equal(m.pick('valeu', { task: { status: 'desistiu' } }).nome, 'feliz');
assert.equal(m.pick('abre o vs code', { task: { status: 'desistiu' } }).nome, 'triste');
assert.equal(m.pick('abre o vs code', { intro: 'Pronto.' }), null);
assert.equal(m.fromGame({ why: 'pedido', seconds: 120 }), 'tonto');
assert.equal(m.fromGame({ why: 'pedido', seconds: 20 }), 'feliz');
console.log('mood: fala, resultado, tela e jogo ok');
