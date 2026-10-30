// Slides em vidro: layout só vale com os dados que ele precisa; fontes só https e públicas.
import assert from 'node:assert/strict';
const { cleanReply, safeUrl } = await import('../lib/assistant.js');
const r = cleanReply({ intro: 'x', slides: [
  { title: 'Torre', narration: 'n', layout: 'destaque', image: 'Torre Eiffel', ficha: [{ k: 'Altura', v: '330 m' }], chart: { type: 'bars', data: [] } },
  { title: 'Planos', narration: 'n', layout: 'cartoes', items: [{ title: 'A', value: '1' }, { title: 'B', text: 'b' }] },
  { title: 'Só um', narration: 'n', layout: 'cartoes', items: [{ title: 'A' }] },
  { title: 'Frase', narration: 'n', layout: 'citacao', quote: { text: 'Penso, logo existo.', author: 'Descartes' } },
  { title: 'Lados', narration: 'n', layout: 'proscontras', pros: ['bom'], cons: [] },
  { title: 'Inventado', narration: 'n', layout: 'holograma' },
  { title: 'Fontes', narration: 'n', sources: [{ title: 'ok', url: 'https://pt.wikipedia.org/wiki/Brasil' }, { title: 'http', url: 'http://x.com' }, { title: 'local', url: 'https://localhost/a' }, { title: 'lixo', url: 'javascript:alert(1)' }] }
] });
assert.deepEqual(r.slides.map(s => s.layout), ['destaque', 'cartoes', '', 'citacao', '', '', '']);
assert.equal(r.slides[0].chart, null, 'slide em vidro não leva gráfico');
assert.equal(r.slides[6].sources.length, 1);
assert.equal(safeUrl('https://user:pw@x.com'), '');
console.log('glass: layouts, dados mínimos e fontes seguras ok');
