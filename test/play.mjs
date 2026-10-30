// "Coloca X": entende o pedido de tocar e de qual serviço; não confunde com outras coisas.
import assert from 'node:assert/strict';
process.env.JARVIS_NO_LISTEN = '1';
const { parsePlay } = await import('../server.js');
assert.deepEqual(parsePlay('coloque interstellar'), { q: 'interstellar', svc: null });
assert.deepEqual(parsePlay('toca a trilha sonora de Interstellar no Spotify'), { q: 'interstellar', svc: 'spotify' });
assert.deepEqual(parsePlay('Jarvis, põe o clipe de Bohemian Rhapsody no YouTube'), { q: 'bohemian rhapsody', svc: 'youtube' });
assert.equal(parsePlay('coloca isso'), null);
assert.equal(parsePlay('coloca o alarme para as 7'), null);
assert.equal(parsePlay('qual a capital da França'), null);
console.log('play: pedidos de tocar ok');
process.exit(0);
