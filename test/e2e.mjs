// Teste de aceitação ponta a ponta, sem internet e sem chaves reais (serviços simulados em mocks.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-e2e-'));
const PORT = 3000 + Math.floor(Math.random() * 900) + 50;
Object.assign(process.env, { JARVIS_DEMO: '1', JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT),
  GEMINI_API_KEY: 'envGeminiSecretKey-AAAA', ANTHROPIC_API_KEY: 'envAnthropicSecret-BBBB', ELEVENLABS_API_KEY: 'envElevenSecret-CCCC', ELEVENLABS_VOICE_ID: 'voiceDemo01' });
const SECRETS = ['envGeminiSecretKey-AAAA', 'envAnthropicSecret-BBBB', 'envElevenSecret-CCCC', 'localGeminiKeyNew-9876', 'demo-access-token', 'demo-refresh-token'];

// Captura tudo que vai para o console (para checar vazamento de chaves nos logs).
const logs = [];
for (const k of ['log', 'warn', 'error']) { const o = console[k]; console[k] = (...a) => { logs.push(a.join(' ')); if (process.env.VERBOSE) o(...a); }; }

const { installMocks, calls } = await import('./mocks.mjs');
installMocks();
const { ROUTER } = await import('../lib/router.js');
ROUTER.baseDelay = 5;
const { _clearWeatherCache } = await import('../lib/weather.js');
const { server } = await import('../server.js');
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const bodies = [];
const B = `http://localhost:${PORT}`;
async function call(method, p, body, { csrf = true, redirect = 'follow' } = {}) {
  const r = await fetch(B + p, { method, redirect, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-jarvis': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); bodies.push(text);
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, headers: r.headers };
}
const ok = (n, m) => console.info(`  ✓ ${n}${m ? ' · ' + m : ''}`);

try {
  // 1. Primeiro acesso
  let r = await call('GET', '/api/state');
  assert.equal(r.j.needsProfile, true);
  const html = (await call('GET', '/')).text;
  assert.match(html, /id="pf"/); assert.match(html, /Conectar Gmail/);
  r = await call('POST', '/api/profile', { name: 'x' }, { csrf: false });
  assert.equal(r.status, 403, 'escrita sem x-jarvis é recusada');
  const geo = (await call('GET', '/api/geocode?q=Jund')).j.results;
  assert.equal(geo[0].name, 'Jundiaí');
  r = await call('POST', '/api/profile', { name: 'Jean-Luc Souza', address: 'senhor', city: geo[0], lang: 'pt-BR' });
  assert.equal(r.status, 200); assert.equal(r.j.needsProfile, false); assert.equal(r.j.profile.name, 'Jean-Luc Souza');
  assert.equal(r.j.profile.city.latitude, undefined, 'coordenadas não vão para o front');
  ok('1. primeiro acesso com formulário', 'perfil salvo, hífen preservado, CSRF bloqueado');

  // 2. Chaves
  r = await call('POST', '/api/keys/gemini', { key: 'localbadKey-12345' });
  assert.equal(r.j.masked, '••••2345');
  r = await call('POST', '/api/keys/gemini/test');
  assert.equal(r.j.test.ok, false); assert.equal(r.j.state, 'error');
  r = await call('POST', '/api/keys/gemini', { key: 'localGeminiKeyNew-9876' });
  assert.equal(r.j.masked, '••••9876'); assert.equal(r.j.source, 'local');
  r = await call('POST', '/api/keys/gemini/test');
  assert.equal(r.j.test.ok, true); assert.equal(r.j.test.message, 'Funcionando.');
  r = await call('POST', '/api/keys/anthropic', { key: 'curta' });
  assert.equal(r.status, 400);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(DIR, 'keys.local.json')).mode & 0o777, 0o600);
  ok('2. salvar e testar chave', 'erro → "Chave inválida"/formato, válida → "Funcionando.", máscara ••••9876, arquivo 600');

  // 3. Nível de modelo
  r = await call('GET', '/api/state');
  assert.ok(r.j.modelWarnings.some(w => w.includes('1.0')) && r.j.modelWarnings.some(w => w.includes('5.1')));
  r = await call('POST', '/api/profile', { level: '5.1' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/profile', { level: '2.5' });
  assert.equal(r.j.profile.level, '2.5');
  calls.models.length = 0;
  r = await call('POST', '/api/chat', { text: 'me fale da população mundial' });
  assert.equal(r.status, 200); assert.equal(calls.models[0], 'gemini/gemini-3.8-flash'); assert.equal(r.j.meta.degraded, false);
  ok('3. troca de nível', 'níveis sem modelo avisados e bloqueados; 2.5 usa gemini-3.8-flash');

  // 4. Saudação sem e com Gmail
  r = await call('POST', '/api/greeting', { fresh: true });
  assert.match(r.j.greeting, /^(Bom dia|Boa tarde|Boa noite), senhor Jean-Luc\.$/);
  assert.equal(r.j.reminder, ''); assert.equal(r.j.gmail, false);
  r = await call('POST', '/api/greeting', {});
  assert.match(r.j.reminder, /conecte o Gmail/i);
  r = await call('POST', '/api/greeting', {});
  assert.equal(r.j.reminder, '', 'lembra só uma vez');
  r = await call('GET', '/auth/google', null, { redirect: 'manual' });
  assert.equal(r.status, 302);
  r = await call('GET', r.headers.get('location'), null, { redirect: 'manual' });
  assert.match(r.headers.get('location'), /gmail=ok/);
  r = await call('GET', '/api/integrations');
  assert.equal(r.j.gmail.state, 'on');
  r = await call('POST', '/api/greeting', {});
  assert.equal(r.j.gmail, true);
  // Pop-ups da saudação: clima + cidade, notícias (país + cidade), estados de agenda/GitHub
  assert.equal(r.j.brief.gmail, true); assert.equal(r.j.brief.city.name, 'Jundiaí'); assert.equal(r.j.brief.weather.temp, 21);
  assert.equal(r.j.brief.news.top.length, 4); assert.equal(r.j.brief.news.top[0].title, 'Banco Central mantém juros na reunião de outubro');
  assert.equal(r.j.brief.news.top[0].source, 'Folha'); assert.ok(r.j.brief.news.local.length >= 1 && r.j.brief.news.local[0].local);
  assert.match(r.j.brief.news.top[3].title, /bancos & varejo/); assert.match(r.j.newsText, /^Nas manchetes, Banco Central/); assert.match(r.j.signoff, /senhor/);
  assert.equal(typeof r.j.brief.calendar, 'boolean'); assert.equal(typeof r.j.brief.githubOn, 'boolean');
  r = await call('POST', '/api/emails/triage');
  assert.equal(r.j.total, 14); assert.equal(r.j.important.length, 5); assert.equal(r.j.others_count, 9);
  const stripe = r.j.important.find(e => e.id === 'm1stripe01');
  assert.equal(stripe.suspicious, true);
  assert.ok(r.j.speech.some(p => /suspeito/.test(p.text)) && r.j.speech.some(p => /estimativa/.test(p.text)));
  assert.equal(r.j.speech.filter(p => p.id).length, 5, 'cada importante tem trecho sincronizado com o cartão');
  r = await call('POST', '/api/emails/m1stripe01/details');
  assert.match(r.j.text, /Stripe/);
  ok('4. saudação com e sem Gmail', `${r.status} · triagem 14 → 5 importantes, Stripe suspeito, lembrete uma vez`);

  // 5. Clima
  r = await call('GET', '/api/weather');
  assert.equal(r.j.weather.temp, 21); assert.equal(r.j.weather.label, 'Nublado');
  _clearWeatherCache(); process.env.DEMO_FAIL = 'weather';
  r = await call('POST', '/api/greeting', {});
  assert.equal(r.status, 200); assert.equal(r.j.weatherText, ''); assert.equal(r.j.weather, null);
  r = await call('GET', '/api/weather'); assert.equal(r.j.weather, null);
  delete process.env.DEMO_FAIL;
  ok('5. clima', '21° nublado; com falha a saudação segue sem clima');

  // 6. Plano B
  calls.models.length = 0;
  r = await call('POST', '/api/chat', { text: 'explique isso com falha simulada' });
  assert.equal(r.status, 200); assert.equal(r.j.meta.degraded, true); assert.equal(r.j.meta.tier, 'reserve'); assert.equal(r.j.meta.provider, 'anthropic');
  assert.deepEqual([...new Set(calls.models)], ['gemini/gemini-3.8-flash', 'gemini/gemini-3.5-flash-lite', 'anthropic/claude-sonnet-5-5']);
  assert.equal(calls.models.filter(m => m === 'gemini/gemini-3.8-flash').length, 3, '3 tentativas com espera');
  r = await call('POST', '/api/chat', { text: 'agora com erro geral' });
  assert.ok([429, 502].includes(r.status)); assert.match(r.j.error, /provedores/);
  ok('6. falha simulada', 'gemini 3× → flash-lite 3× → reserva anthropic (meta.degraded)');

  // 7. Quatro estados do círculo (verificação estática do front)
  for (const s of ['class="preloader"', 'crack crack5', 'class="loader-wrapper"', 'Uiverse.io, narmesh_sah', 'Uiverse.io, dexter-st', 'prefers-reduced-motion', "body[data-m=think] #orb .l-think", "body[data-m=speak] #orb .l-speak", "body[data-m=listen] #orb .ring"]) assert.ok(html.includes(s), s);
  assert.ok(!/#7c3aed|purple|#8b5cf6|#a855f7/i.test(html.slice(html.indexOf('.loader-wrapper'), html.indexOf('/* ---------- Pop-ups'))), 'esfera sem roxo');
  ok('7. quatro estados', 'marcação e CSS presentes (visual conferido só no navegador)');

  // 8. Memória
  const memFile = () => JSON.parse(fs.readFileSync(path.join(DIR, 'memory.json'), 'utf8'));
  r = await call('POST', '/api/chat', { text: 'oi' });
  const before = memFile().turns.length;
  r = await call('POST', '/api/chat', { text: 'esqueça isso' });
  assert.equal(r.j.command, 'forget_last'); assert.equal(memFile().turns.length, before - 2);
  r = await call('POST', '/api/chat', { text: 'JARVIS, o que você lembra de mim?' });
  assert.match(r.j.intro, /Jean-Luc/);
  assert.ok(memFile().emails.length > 0 && !JSON.stringify(memFile().emails).includes('Atenciosamente'), 'e-mails: só resumo, nunca corpo');
  r = await call('POST', '/api/chat', { text: 'esqueça tudo' });
  assert.equal(r.j.command, 'forget_all');
  const m = memFile(); assert.equal(m.turns.length + m.prefs.length + m.emails.length + m.summary.length, 0);
  assert.equal((await call('GET', '/api/state')).j.profile.name, 'Jean-Luc Souza', 'perfil continua');
  ok('8. esqueça isso / esqueça tudo', 'memória limpa, perfil mantido');

  // Desconectar Gmail e remover chave
  r = await call('POST', '/auth/google/disconnect'); assert.equal(r.j.gmail.state, 'off');
  r = await call('DELETE', '/api/keys/gemini'); assert.equal(r.j.source, 'env');

  // 9. Nenhuma chave no front nem nos logs
  const all = [html, ...bodies, ...logs].join('\n');
  for (const s of SECRETS) assert.ok(!all.includes(s), `vazou: ${s.slice(0, 6)}…`);
  assert.ok(!/localStorage|sessionStorage/.test(html), 'front não usa storage');
  ok('9. nenhuma chave no front, nas respostas ou nos logs', `${bodies.length} respostas e ${logs.length} linhas de log varridas`);
  console.info('e2e: ok');
} finally {
  server.close(); fs.rmSync(DIR, { recursive: true, force: true });
}
