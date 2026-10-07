// Correções: agenda (criar x ler), GitHub (honestidade e repositórios) e contexto da tela. Sem internet.
import fs from 'node:fs';
import assert from 'node:assert/strict';
// A pasta de dados precisa ser definida ANTES de carregar os módulos (import estático rodaria antes).
process.env.JARVIS_DATA_DIR = '/tmp/jarvis-fixes-test';
process.env.GEMINI_API_KEY = 'gem-test-key-123456';
fs.rmSync('/tmp/jarvis-fixes-test', { recursive: true, force: true });
const { detectIntent: d, cleanEvent, askScreen, recordTurn, parseEvent } = await import('../lib/assistant.js');
const calendar = await import('../lib/calendar.js');
const github = await import('../lib/github.js');
const memory = await import('../lib/memory.js');
const actions = await import('../lib/actions.js');
const google = await import('../lib/google.js');
const { loadModels } = await import('../lib/models.js');

/* 1. "marca na agenda" NÃO é "o que tenho hoje" */
for (const t of ['marca uma reunião amanhã às 15h na minha agenda', 'agenda um dentista sexta às 9', 'cria um compromisso dia 15 às 10h', 'coloca na agenda almoço com o João quinta 12h'])
  assert.equal(d(t)?.kind, 'agenda_create', t);
for (const t of ['o que eu tenho hoje na minha agenda?', 'qual minha agenda hoje', 'o que eu tenho marcado amanhã', 'quando eu estou livre hoje'])
  assert.equal(d(t)?.kind, 'agenda', t);
assert.equal(d('o que eu tenho marcado amanhã').range, 'tomorrow');
assert.equal(d('me ajude a preparar uma reunião de vendas'), null);

/* 2. GitHub: repositórios têm intenção própria; PR e testes continuam */
assert.deepEqual([d('ler meus repositórios do github').focus, d('ler meus repositórios do github').repo], ['repos', null]);
assert.equal(d('me fala do repositório jarvis-app').repo, 'jarvis app');
assert.equal(d('quais os últimos commits do repo jarvis app').focus, 'commits');
assert.equal(d('tenho PR para revisar?').focus, 'review');
assert.equal(d('como está o CI?').focus, 'ci');

/* 3. Tela: comentário seguinte continua no assunto só enquanto compartilha */
assert.equal(d('acho que foi culpa do cache', { screenFollow: true })?.kind, 'screen');
assert.equal(d('acho que foi culpa do cache'), null);
assert.equal(d('marca reunião amanhã às 15h na agenda', { screenFollow: true })?.kind, 'agenda_create');

/* 4. cleanEvent valida data, hora, passado e duração */
const tz = 'America/Sao_Paulo', now = calendar.zoned(2026, 10, 6, 12, 0, tz), Z = { now, tz, zoned: calendar.zoned };
const ok = cleanEvent({ title: ' Dentista ', date: '2026-10-07', time: '15:00', duration_min: 45 }, Z);
assert.equal(ok.title, 'Dentista'); assert.equal(ok.end - ok.start, 45 * 60_000);
assert.equal(calendar.whenSpeech(ok.start, tz, now), 'amanhã, às 15h');
assert.equal(calendar.durationSpeech(60 * 60_000), 'uma hora');
assert.equal(cleanEvent({ title: 'X', date: '2026-10-07', time: '', duration_min: 60 }, Z).error, 'time');
assert.equal(cleanEvent({ title: 'X', date: '', time: '10:00' }, Z).error, 'date');
assert.equal(cleanEvent({ title: '', date: '2026-10-07', time: '10:00' }, Z).error, 'title');
assert.equal(cleanEvent({ title: 'X', date: '2026-10-05', time: '10:00' }, Z).error, 'past');
assert.equal(cleanEvent({ title: 'X', date: '2030-10-05', time: '10:00' }, Z).error, 'far');
assert.equal(cleanEvent({ title: 'X', date: '2026-10-07', time: '25:00' }, Z).error, 'time');
assert.equal(cleanEvent({ title: 'X', date: '2026-10-07', time: '10:00', duration_min: 99999 }, Z).end - cleanEvent({ title: 'X', date: '2026-10-07', time: '10:00' }, Z).start, 1440 * 60_000);
assert.equal(cleanEvent({ title: 'X', date: '2026-10-07', time: '10:00', duration_min: 'abc' }, Z).end - cleanEvent({ title: 'X', date: '2026-10-07', time: '10:00' }, Z).start, 3600_000);

/* 5. Ação de agenda: confirmação obrigatória, parâmetros validados, sem apagar/editar */
actions._reset();
assert.throws(() => actions.createAction('calendar_create', { title: 'X', start: 5, end: 3, tz }, []));
const act = actions.createAction('calendar_create', { title: 'X', start: ok.start, end: ok.end, tz }, []);
assert.equal(act.risk, 'normal');
assert.equal((await actions.confirmAction(act.id, 'voz')).kind, 'calendar_create');
await assert.rejects(() => actions.confirmAction(act.id, 'voz'), /já foi confirmada|expirada/);
await assert.rejects(() => google.createCalendarEvent({ title: 'X', start: ok.start, end: ok.end, tz }), /permissão/);
assert.ok(!Object.keys(google).some(k => /deleteCalendar|updateCalendar/i.test(k)));
actions._reset();

/* 6. GitHub não finge que está tudo ok */
const base = { review: [], mine: [], issues: [], ci: [], ciChecked: 4, ciWithRuns: 2, ciTotal: 4, failed: [], repos: [] };
const sp = x => github.summarySpeech({ ...base, ...x });
assert.match(sp({}), /passando nos 2 repositórios.*só consegui verificar 4 de 4|passando nos 2 repositórios/);
assert.match(sp({ ciChecked: 0, ciWithRuns: 0 }), /Não consegui verificar os testes automáticos/);
assert.match(sp({ ciChecked: 3, ciWithRuns: 0 }), /Não encontrei testes automáticos/);
assert.match(sp({ failed: ['revisões pedidas'] }), /Atenção: não consegui consultar revisões pedidas/);
assert.ok(!/Nenhum pull request/.test(sp({ failed: ['revisões pedidas'] })), 'não pode dizer "nenhum PR" se a consulta falhou');
assert.match(sp({ ci: [{ repo: 'a/jarvis-app' }] }), /falhando em jarvis app/);
for (const x of [sp({}), sp({ ciChecked: 0 })]) assert.ok(!/\bCI\b|\bPRs?\b/.test(x), 'sem siglas na voz: ' + x);
const iso = new Date(Date.now() - 2 * 86400_000).toISOString();
assert.equal(github.ago(iso), 'há 2 dias');
assert.match(github.reposSpeech([{ repo: 'me/jarvis-app', pushed_at: iso }, { repo: 'me/site', pushed_at: iso }]), /dois|2 repositórios/);
assert.match(github.reposSpeech([]), /Não encontrei repositórios/);
assert.match(github.overviewSpeech({ repo: 'me/jarvis-app', language: 'JavaScript', description: 'Assistente por voz', pushed_at: iso, commits: [{ message: 'corrige agenda', author: 'Eu' }], open_issues: 2 }), /jarvis app, em JavaScript.*Assistente por voz.*corrige agenda/);

/* 7. Contexto: respostas locais entram na memória e a tela recebe o histórico */
memory._reset();
recordTurn({}, 'olha minha tela', 'Vejo um erro de CORS no console.', 'Vendo a tela do usuário');
const ctx = memory.context();
assert.equal(ctx.messages.length, 2);
assert.match(ctx.messages[1].content, /Vendo a tela do usuário.*CORS/);
let bodies = [];
globalThis.fetch = async (u, o) => { bodies.push(JSON.parse(o.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Reunião com Ana","date":"2026-10-07","time":"15:00","duration_min":60}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
const models = loadModels();
await askScreen(models, { name: 'Ana', treatment: 'senhor' }, 'e isso é culpa do servidor?', 'data:image/jpeg;base64,QUJD', ctx.messages);
const sent = bodies.at(-1).contents.map(c => c.parts[0].text);
assert.ok(sent.some(t => /CORS/.test(t)), 'a pergunta seguinte sobre a tela deve levar a conversa anterior');
assert.equal(bodies.at(-1).contents.at(-1).parts[1].inlineData.mimeType, 'image/jpeg');
const raw = await parseEvent(models, { name: 'Ana' }, 'marca reunião com Ana amanhã às 15h', { now, tz, zoned: calendar.zoned, weekdayName: 'terça-feira', dateKey: '2026-10-06' });
assert.equal(cleanEvent(raw, Z).title, 'Reunião com Ana');
assert.match(bodies.at(-1).systemInstruction.parts[0].text, /2026-10-06/);

console.log('fixes: ok');
