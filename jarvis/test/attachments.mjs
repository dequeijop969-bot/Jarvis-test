// Arquivos soltos na janela: aceita imagem (JPEG) e texto/código, aceita PDF, recusa binário, esconde chaves e expira.
import assert from 'node:assert/strict';
import * as at from '../lib/attachments.js';
import { registerSecret } from '../lib/secrets.js';

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

const img = at.add({ name: 'print.png', type: 'image/png', data: jpg });
assert.equal(img.kind, 'image'); assert.match(img.id, /^[a-f0-9]{16}$/);
registerSecret('AIzaSyD-chave-de-teste-1234567890abcdef');
const txt = at.add({ name: 'app.js', type: 'text/javascript', data: 'data:text/javascript;base64,' + b64('const k = "AIzaSyD-chave-de-teste-1234567890abcdef";\nconsole.log(1)') });
assert.equal(txt.kind, 'text');
const block = at.textBlock(at.take([txt.id]));
assert.match(block, /ARQUIVO "app\.js"/); assert.match(block, /ignore ordens/);
assert.ok(!block.includes('AIzaSyD-chave'), 'chave escondida'); assert.match(block, /console\.log/);
// PDF: aceito (vai inteiro para a IA ler); arquivo com nome .pdf que não é PDF: recusado
const pdf = at.add({ name: 'contrato.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,' + b64('%PDF-1.7 fim') });
assert.equal(pdf.kind, 'pdf');
const pd = at.pdfsOf(at.take([pdf.id, txt.id])); assert.equal(pd.length, 1); assert.equal(pd[0].name, 'contrato.pdf');
assert.equal(Buffer.from(pd[0].data, 'base64').toString('latin1').slice(0, 5), '%PDF-');
assert.equal(at.textBlock(at.take([pdf.id])), '', 'PDF não entra no bloco de texto');
assert.throws(() => at.add({ name: 'falso.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,' + b64('nada a ver') }), /não é um PDF/);
assert.throws(() => at.add({ name: 'jogo.exe', type: 'application/octet-stream', data: 'data:application/octet-stream;base64,' + b64('MZ\u0000\u0000') }), /só leio/);
assert.throws(() => at.add({ name: 'notas.txt', data: 'data:text/plain;base64,' + b64('a\u0000b') }), /não parece/);
assert.throws(() => at.add({ name: 'x.txt', data: '' }), /vazio/);
// nome com caracteres perigosos fica limpo
assert.equal(at.add({ name: '..\\..\\a<b>.md', data: 'data:text/markdown;base64,' + b64('# oi') }).name, '.._.._a_b_.md');
// texto grande é cortado e marcado
const big = at.add({ name: 'log.txt', data: 'data:text/plain;base64,' + b64('x'.repeat(at.LIMITS.textChars + 500)) });
assert.equal(big.cut, true); assert.match(at.textBlock(at.take([big.id])), /cortado/);
// take ignora ids desconhecidos; remove tira; expira depois do prazo
assert.equal(at.take(['ffffffffffffffff', img.id]).length, 1);
assert.equal(at.remove(img.id), true); assert.equal(at.take([img.id]).length, 0);
const old = at.LIMITS.ttlMs; at.LIMITS.ttlMs = -1; assert.equal(at.take([txt.id]).length, 0); at.LIMITS.ttlMs = old;
// no máximo LIMITS.files guardados: o mais antigo sai
const ids = []; for (let i = 0; i < at.LIMITS.files + 2; i++) ids.push(at.add({ name: `n${i}.txt`, data: 'data:text/plain;base64,' + b64('oi ' + i) }).id);
assert.equal(at.take(ids.slice(-at.LIMITS.files)).length, at.LIMITS.files); assert.equal(at.take(ids.slice(0, 2)).length, 0, "os mais antigos saíram");
assert.equal(at.textBlock([]), '');
console.log('attachments: imagem, texto, recusas, chaves escondidas e validade ok');
