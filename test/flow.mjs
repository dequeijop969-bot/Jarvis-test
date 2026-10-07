// Fluxo completo pelo servidor (HTTP real; Google, GitHub e Gemini simulados): agenda, GitHub e contexto da tela.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-flow-'));
const PORT = 4000 + Math.floor(Math.random() * 800);
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'flowGeminiKey-123456', GITHUB_TOKEN_READ: 'github_pat_flowtoken123456', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret' });
for (const k of ['log', 'warn', 'error', 'info']) console[k] = () => {};

const calendar = await import('../lib/calendar.js');
const { setTokens } = await import('../lib/oauth.js');
const tz = 'America/Sao_Paulo', t0 = Date.now();
const tomorrow = calendar.dayStart(t0, tz, 1), tomKey = calendar.todayKey(tomorrow, tz);
const clashStart = calendar.zoned(+tomKey.slice(0, 4), +tomKey.slice(5, 7), +tomKey.slice(8), 15, 30, tz);
setTokens('google', { access_token: 'tok-flow-1', refresh_token: 'ref-flow-1', expires_at: t0 + 3600e3, scope: [
  'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'].join(' '), email: 'x@y.z' });

const real = globalThis.fetch, gemini = [], gcalPosts = [], J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': '9999999999', ...h } });
const gtext = t => J({ candidates: [{ content: { parts: [{ text: t }] } }] });
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) return real(u, o);
  if (u.includes('generativelanguage.googleapis.com')) {
    const b = JSON.parse(o.body); gemini.push(b);
    const sys = b.systemInstruction.parts[0].text;
    if (sys.includes('extrai UM compromisso')) return gtext(JSON.stringify({ title: 'Reunião com a Ana', date: tomKey, time: '15:00', duration_min: 60 }));
    if (sys.includes('resume um repositório')) return gtext('{"text":"Assistente de voz pessoal."}');
    if (sys.includes('Retorne SOMENTE JSON')) return gtext(JSON.stringify({ topic: 'Papo', intro: 'Pode ser, vale testar sem o cache.', chart: null, slides: [], outro: '', remember: [] }));
    return gtext('Vejo um erro de CORS no console do navegador.');
  }
  if (u.includes('googleapis.com/calendar/v3/users/me/calendarList')) return J({ items: [{ id: 'primary', summary: 'Eu', primary: true, selected: true }] });
  if (u.includes('googleapis.com/calendar/v3/calendars/primary/events') && o.method === 'POST') { gcalPosts.push(JSON.parse(o.body)); return J({ id: 'ev1', htmlLink: 'https://calendar.google.com/event?eid=ev1' }); }
  if (u.includes('googleapis.com/calendar/v3/calendars/')) {
    const q = new URL(u).searchParams, from = Date.parse(q.get('timeMin')), to = Date.parse(q.get('timeMax'));
    const ev = { id: 'e1', summary: 'Dentista', start: { dateTime: new Date(clashStart).toISOString() }, end: { dateTime: new Date(clashStart + 3600e3).toISOString() } };
    return J({ items: ev && clashStart < to && clashStart + 3600e3 > from ? [ev] : [] });
  }
  if (u.includes('api.github.com')) {
    const p = u.replace('https://api.github.com', '');
    if (p.startsWith('/search/issues') && decodeURIComponent(p).includes('review-requested')) return J({ message: 'forbidden' }, 403);
    if (p.startsWith('/search/issues')) return J({ items: [] });
    if (p.startsWith('/user/repos')) return J([{ full_name: 'me/jarvis-app', default_branch: 'main', html_url: 'x', private: true, pushed_at: new Date(t0 - 86400e3).toISOString() }, { full_name: 'me/site-pessoal', default_branch: 'main', html_url: 'y', private: false, pushed_at: new Date(t0 - 9 * 86400e3).toISOString() }]);
    if (/\/actions\/runs/.test(p)) return J({ message: 'Not Found' }, 404);
    if (/\/commits\?/.test(p)) return J([{ sha: 'abcdef123', commit: { message: 'corrige agenda\n\ncorpo', author: { name: 'Eu', date: new Date(t0 - 3600e3).toISOString() } }, html_url: 'z' }]);
    if (/\/readme$/.test(p)) return J({ content: Buffer.from('# Jarvis\n\nAssistente de voz pessoal com agenda, e-mails e GitHub. '.repeat(3)).toString('base64') });
    if (/^\/repos\/me\/jarvis-app$/.test(p)) return J({ description: 'Meu assistente', language: 'JavaScript', private: true, default_branch: 'main', pushed_at: new Date(t0 - 86400e3).toISOString(), open_issues_count: 2 });
    return J({ message: 'Not Found' }, 404);
  }
  throw new Error('fetch inesperado: ' + u.slice(0, 80));
};

const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const B = `http://localhost:${PORT}`;
const call = async (p, body) => { const r = await real(B + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
const say = (text, screen) => call('/api/chat', { text, ...(screen ? { screen } : {}) });
const IMG = 'data:image/jpeg;base64,QUJD';
const ok = (n, m) => process.stdout.write(`  ✓ ${n}${m ? ' · ' + m : ''}\n`);

try {
  let r = await call('/api/profile', { name: 'Ana', address: 'senhor', city: { name: 'Jundiaí', country: 'Brasil', timezone: tz, latitude: -23.18, longitude: -46.88 }, lang: 'pt-BR' });
  assert.equal(r.status, 200, JSON.stringify(r.j));

  // A) Agenda: "marca" cria (com confirmação); "o que tenho" lê. Nunca "Agenda livre" para um pedido de marcar.
  r = await say('marca uma reunião com a Ana amanhã às 15h na minha agenda');
  assert.ok(!/Agenda livre/.test(r.j.intro), r.j.intro);
  assert.match(r.j.intro, /Posso marcar Reunião com a Ana, amanhã, às 15h, por uma hora\./);
  assert.match(r.j.intro, /Atenção: isso bate com Dentista/);
  assert.equal(r.j.action.kind, 'calendar_create'); assert.equal(gcalPosts.length, 0, 'nada é criado antes de confirmar');
  r = await say('confirmo');
  assert.match(r.j.intro, /^Marcado, senhor: Reunião com a Ana, amanhã, às 15h\./);
  assert.equal(gcalPosts.length, 1); assert.equal(gcalPosts[0].summary, 'Reunião com a Ana'); assert.equal(gcalPosts[0].start.timeZone, tz);
  assert.equal(new Date(gcalPosts[0].end.dateTime) - new Date(gcalPosts[0].start.dateTime), 3600e3);
  r = await say('confirmo'); assert.equal(gcalPosts.length, 1, 'confirmar de novo não cria outro');
  r = await say('o que eu tenho amanhã na agenda'); assert.match(r.j.intro, /Dentista/); assert.equal(gcalPosts.length, 1);
  ok('agenda', 'marcar pede confirmação, avisa conflito e só cria depois; ler continua lendo');

  // B) GitHub
  r = await say('ler meus repositórios do github');
  assert.match(r.j.intro, /2 repositórios liberados.*jarvis app, mexido ontem/); assert.ok(!/\bCI\b/.test(r.j.intro));
  r = await say('me fala do repositório jarvis-app');
  assert.match(r.j.intro, /jarvis app, em JavaScript, privado\. Assistente de voz pessoal\..*Último commit: corrige agenda/);
  r = await say('quais os últimos commits do jarvis-app no github');
  assert.match(r.j.intro, /Últimos commits de jarvis app: corrige agenda, hoje/);
  r = await say('como está o CI no github?');
  assert.match(r.j.intro, /Não consegui verificar os testes automáticos/); assert.ok(!/verde|passando/.test(r.j.intro), r.j.intro);
  r = await say('tenho PR para revisar no github?');
  assert.match(r.j.intro, /Atenção: não consegui consultar revisões pedidas/); assert.ok(!/Nenhum pull request/.test(r.j.intro), r.j.intro);
  ok('github', 'lista e abre repositórios; falha de consulta nunca vira "tudo ok"');

  // C) Tela: o comentário seguinte continua no assunto, e a conversa lembra da tela mesmo depois
  r = await say('olha minha tela', IMG); assert.match(r.j.intro, /CORS/);
  const n0 = gemini.length;
  r = await say('acho que foi culpa do cache', IMG);
  const b = gemini[n0], all = b.contents.map(c => c.parts[0].text).join(' | ');
  assert.match(all, /CORS/, 'a pergunta seguinte enviou a conversa anterior'); assert.ok(b.contents.at(-1).parts[1]?.inlineData, 'e a imagem atual');
  r = await say('parei de compartilhar, mas voltando: acho que foi o cache mesmo');
  const last = gemini.at(-1).contents.map(c => c.parts[0].text).join(' | ');
  assert.match(last, /Vendo a tela do usuário.*CORS/, 'sem tela, a conversa normal ainda lembra do que foi visto');
  r = await say('para de ver minha tela'); assert.equal(r.j.screenStop, true);
  const n1 = gemini.length; await say('o que você acha disso?', IMG);
  assert.ok(!/inlineData/.test(JSON.stringify(gemini.slice(n1))), 'depois de parar, a tela não é mais usada como continuação automática');
  ok('tela', 'follow-up com histórico, memória da tela na conversa normal, parar encerra a continuação');
  process.stdout.write('flow: ok\n');
} finally { server.close(); }
