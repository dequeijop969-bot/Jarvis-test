import assert from 'node:assert/strict';
import { detectIntent as d } from '../lib/assistant.js';
const k = t => d(t)?.kind ?? null;
assert.equal(k('Jarvis, o que eu tenho hoje na minha agenda?'), 'agenda');
assert.equal(d('o que tenho amanhã?').range, 'tomorrow');
assert.equal(d('qual minha agenda da semana').range, 'week');
assert.equal(k('quando eu estou livre hoje'), 'agenda');
assert.equal(k('tenho PR para revisar?'), 'github'); assert.equal(d('tenho PR para revisar?').focus, 'review');
assert.equal(d('como está o CI?').focus, 'ci');
assert.equal(k('desfaz'), 'undo'); assert.equal(k('confirmo'), 'confirm'); assert.equal(k('cancela'), 'cancel');
assert.equal(d('joga os suspeitos na lixeira').target, 'suspicious');
assert.equal(d('exclui os e-mails da stripe').sender, 'stripe');
assert.equal(k('me ajude a preparar uma reunião de vendas'), null);
assert.equal(k('quem inventou o telefone?'), null);
console.log('intents: ok');
import { detectIntent as di } from '../lib/assistant.js';
assert.equal(di('olha minha tela').kind, 'screen');
assert.equal(di('o que está na minha tela?').kind, 'screen');
assert.equal(di('para de ver minha tela').kind, 'screen_stop');
assert.equal(di('me ajuda com esse erro', { screenOn: true }).kind, 'screen');
assert.equal(di('me ajuda com esse erro'), null);
assert.equal(di('qual a capital da França?', { screenOn: true }), null);
console.log('intents(tela): ok');

// Regressão: "Marque ..." (com Q) e "me lembra" caíam na leitura da agenda ("Agenda livre hoje").
for (const f of [
  'Marque um compromisso chamado melhoria no site do jarvis para hoje as 11:59 da noite',
  'marque uma reunião com o cliente amanhã às 15',
  'me lembra de pagar a conta amanhã às 9',
]) assert.equal(k(f), 'agenda_create', f);
for (const f of ['o que tenho na agenda hoje', 'quais compromissos eu tenho hoje', 'agenda livre hoje?'])
  assert.equal(k(f), 'agenda', f);
assert.equal(k('me ajuda a preparar uma reunião'), null);

// Regressão: "sheet is not defined" — o botão GitHub (script principal) usa sheet/closeSheet definidos em outro bloco.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(/window\.sheet\s*=\s*sheet/.test(html) && /window\.closeSheet\s*=\s*closeSheet/.test(html), 'sheet/closeSheet precisam ser globais');
console.log('intents(regressão agenda/sheet): ok');
