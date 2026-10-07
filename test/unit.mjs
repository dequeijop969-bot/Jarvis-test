// Testes rápidos das funções puras do servidor.
process.env.JARVIS_NO_LISTEN = '1';
import assert from 'node:assert/strict';
const { wordsFromAlignment, cleanChart, cleanReply } = await import('../server.js');

const text = 'Olá, senhor.  Tudo bem?';
const ch = [...text], s = ch.map((_, i) => i * 0.1), e = ch.map((_, i) => i * 0.1 + 0.1);
const w = wordsFromAlignment({ characters: ch, character_start_times_seconds: s, character_end_times_seconds: e });
assert.deepEqual(w.map(x => x.w), ['Olá,', 'senhor.', 'Tudo', 'bem?']);
assert.equal(w[1].s, 0.5); assert.equal(w[1].e, 1.2);
assert.equal(wordsFromAlignment({ characters: ['a'], character_start_times_seconds: [], character_end_times_seconds: [] }), null);
assert.equal(wordsFromAlignment(null), null);

assert.equal(cleanChart({ type: 'bars', data: [{ label: 'a' }, { label: 'b' }] }), null, 'barras sem números somem');
assert.equal(cleanChart({ type: 'pizza', data: [] }), null);
const r = cleanChart({ type: 'ranking', unit: '%', data: [{ label: 'a', value: 1 }, { label: 'b', value: '3,5' }] });
assert.deepEqual(r.data.map(d => d.label), ['b', 'a']); assert.equal(r.data[0].value, 3.5);
const t = cleanChart({ type: 'timeline', data: [{ label: '1969', text: 'Lua', value: 9 }, { label: '1990', text: 'Web' }] });
assert.equal(t.data[0].value, undefined);
assert.equal(cleanChart({ type: 'compare', data: [{ label: 'a', value: 1 }] }), null);
const rep = cleanReply({ intro: 'oi', slides: [{ title: 'x', narration: '' }, { title: 'y', narration: 'fala', chart: { type: 'bignumber', data: [{ label: 'n', value: 42 }] } }] });
assert.equal(rep.slides.length, 1); assert.equal(rep.slides[0].chart.data[0].value, 42);
console.log('unit: ok');
