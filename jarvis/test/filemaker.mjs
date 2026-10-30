// Criar/editar arquivos para o correio: entende o pedido, valida o que a IA devolve e limpa o HTML do PDF.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const f = await import('../lib/filemaker.js');
assert.equal(f.detect('cria um PDF com a lista de compras e me manda pelo correio', false), 'criar');
assert.equal(f.detect('faz uma planilha dos meus gastos', false), 'criar');
assert.equal(f.detect('edita esse pdf: muda o valor para 1500 e me devolve', true), 'editar');
assert.equal(f.detect('corrige os erros desse documento', true), 'editar');
assert.equal(f.detect('edita esse pdf e me devolve', false), null, 'sem arquivo não há o que editar');
assert.equal(f.detect('me manda um email com o relatório', false), null, 'e-mail é outra coisa');
assert.equal(f.detect('qual a capital da França', false), null);
const p = f.cleanPlan({ formato: 'PDF', nome: 'Lista: compras/churrasco?.pdf', titulo: 'Lista', conteudo: '<h1>Oi</h1>' });
assert.equal(p.formato, 'pdf'); assert.equal(p.nome, 'Lista-compras-churrasco.pdf');
assert.equal(f.cleanPlan({ formato: 'exe', nome: 'x', conteudo: 'abc' }).formato, 'pdf', 'formato estranho vira PDF');
assert.throws(() => f.cleanPlan({ formato: 'txt', conteudo: '' }));
const h = f.safeHtml('<h1 onclick="x()">T</h1><script>alert(1)</script><img src=x onerror=alert(1)><p style="color:red">ok</p><a href="https://x">link</a>');
assert.ok(!/script|onerror|onclick|<img|style=|href/.test(h), h); assert.match(h, /<h1>T<\/h1>/); assert.match(h, /<p>ok<\/p>/);
// grava texto sem sobrescrever
f.OUT.dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fm-'));
const dir = f.OUT.dir(); f.OUT.dir = () => dir;
const a = await f.write({ formato: 'csv', nome: 'gastos.csv', conteudo: 'Item;Valor\nPão;5' });
const b = await f.write({ formato: 'csv', nome: 'gastos.csv', conteudo: 'x' });
assert.notEqual(a, b); assert.ok(fs.readFileSync(a, 'utf8').startsWith('\ufeffItem;Valor'));
console.log('filemaker: pedidos, validação, HTML seguro e gravação ok');
