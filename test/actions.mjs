// Ações sob pedido: validação, limites, toggles e ausência de exclusão permanente. Sem internet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Pasta de dados isolada, definida ANTES de carregar os módulos: o teste nunca toca em data/ (chaves e tokens reais).
process.env.JARVIS_DATA_DIR = '/tmp/jarvis-actions-test';
fs.rmSync('/tmp/jarvis-actions-test', { recursive: true, force: true });
const actions = await import('../lib/actions.js');
const google = await import('../lib/google.js');
const throws = (f, m) => { let ok = false; try { f(); } catch { ok = true; } assert.ok(ok, m); };
assert.ok(!Object.keys(google).some(k => /delete|destroy|empty/i.test(k)), 'google.js não pode ter exclusão permanente');
actions._reset();
throws(() => actions.createAction('gmail_delete', { ids: ['abc123'] }, []), 'tipo fora da lista deve ser recusado');
throws(() => actions.createAction('gmail_trash', { ids: Array.from({ length: 26 }, (_, i) => 'id' + i + 'abcd'), preview: [] }, []), 'mais de 25 deve ser recusado');
assert.equal(actions.createAction('gmail_trash', { ids: Array.from({ length: 11 }, (_, i) => 'id' + i + 'abcd'), preview: [] }, []).risk, 'alto');
const a = actions.createAction('gmail_trash', { ids: ['abc123'], preview: [] }, []);
await assert.rejects(() => actions.confirmAction(a.id, 'x'), /desligadas/, 'toggle desligado deve recusar');
actions.setToggle('gmail_trash', true);
assert.equal((await actions.confirmAction(a.id, 'x')).success, true);
await assert.rejects(() => actions.confirmAction(a.id, 'x'), /já foi confirmada|expirada/, 'uso único');
actions.setToggle('gmail_trash', false); actions._reset();
console.log('actions: ok');
