// Caixa de correio: cartas do Jarvis (caminho no disco) e suas (na memória), escolha pelo pedido, entrega e lista salva.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'correio-'));
const c = await import('../lib/correio.js');
c.init(dir);
const f = path.join(dir, 'padaria.html'); fs.writeFileSync(f, '<h1>Pão</h1>');
const a = c.deliver({ from: 'jarvis', path: f, note: 'feito pelo Jarvis Code' });
assert.equal(a.kind, 'code'); assert.equal(a.disco, true); assert.equal(a.novo, true);
const b = c.deliver({ from: 'voce', name: 'contrato.pdf', data: Buffer.from('%PDF-1.7 x') });
assert.equal(b.kind, 'pdf'); assert.equal(b.disco, false);
assert.equal(c.list()[0].id, b.id, 'mais nova primeiro');
// o mesmo arquivo de novo (editado): não duplica
c.deliver({ from: 'jarvis', path: f }); assert.equal(c.list().filter(x => x.name === 'padaria.html').length, 1);
// pedidos
assert.equal(c.isRequest('me manda o arquivo que você criou'), 'enviar');
assert.equal(c.isRequest('Jarvis, envia o PDF'), 'enviar');
assert.equal(c.isRequest('abre o correio'), 'abrir');
assert.equal(c.isRequest('manda um e-mail pro João com o arquivo'), null, 'e-mail não é correio');
assert.equal(c.isRequest('qual a previsão do tempo'), null);
assert.equal(c.pick('me devolve o pdf').name, 'contrato.pdf');
assert.equal(c.pick('manda a padaria').name, 'padaria.html');
assert.equal(c.pick('me manda o arquivo').from, 'jarvis', 'sem dizer qual: o mais novo do Jarvis');
assert.equal(c.pick('me manda o arquivo que eu mandei').from, 'voce');
// conteúdo e entrega de novo
assert.equal(c.content(b.id).buf.toString(), '%PDF-1.7 x');
c.markSeen(); assert.equal(c.count().novas, 0);
const pd = c.list().find(x => x.name === 'padaria.html'); const r = c.redeliver(pd.id);
assert.equal(r.novo, true); assert.equal(c.list()[0].id, pd.id);
// a lista salva só tem as cartas do disco (nunca o conteúdo das suas)
const saved = JSON.parse(fs.readFileSync(path.join(dir, 'correio.json'), 'utf8'));
assert.equal(saved.length, 1); assert.ok(!('data' in saved[0]));
// arquivo apagado do disco: a carta sai ao tentar baixar
fs.unlinkSync(f); assert.equal(c.content(pd.id), null); assert.ok(!c.list().some(x => x.id === pd.id));
console.log('correio: cartas, pedidos, escolha, entrega e lista salva ok');
