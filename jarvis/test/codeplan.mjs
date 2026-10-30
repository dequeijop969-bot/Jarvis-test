// Saudação com tarefas separadas pela agenda, "prepara" que abre os apps, e o Talk recomendando o modo Code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-plan-'));
const PORT = 4800 + Math.floor(Math.random() * 150);
Object.assign(process.env, { JARVIS_NO_LISTEN: '1', JARVIS_DATA_DIR: DIR, PORT: String(PORT), GEMINI_API_KEY: 'planGeminiKey-123456', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
for (const k of ['log', 'warn', 'error', 'info']) console[k] = () => {};

const calendar = await import('../lib/calendar.js');
const { setTokens } = await import('../lib/oauth.js');
const tz = 'America/Sao_Paulo', t0 = Date.now(), today = calendar.todayKey(t0, tz), tomorrow = calendar.todayKey(calendar.dayStart(t0, tz, 1), tz);
setTokens('google', { access_token: 'tok-plan', refresh_token: 'ref-plan', expires_at: t0 + 3600e3, scope: 'https://www.googleapis.com/auth/calendar.readonly', email: 'x@y.z' });

const real = globalThis.fetch, J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const gtext = t => J({ candidates: [{ content: { parts: [{ text: t }] } }] });
let talkReply = { topic: 'Code', intro: 'Isso é trabalho para o modo Code, senhor.', chart: null, slides: [], outro: '', remember: [], image_search: '', sugerir_code: true };
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) return real(u, o);
  if (u.includes('generativelanguage.googleapis.com')) {
    const sys = JSON.parse(o.body).systemInstruction.parts[0].text;
    // A IA separa a tarefa: um app que não existe ("photoshop") e um compromisso inventado são descartados.
    if (sys.includes('Olhe os compromissos de hoje')) return gtext(JSON.stringify({ planos: [
      { evento: 'Entrega do site da padaria', tarefa: 'Criar o index.html com o cardápio.', pedido: 'abre o VS Code e cria um index.html da padaria com cardápio', apps: ['vs code', 'chrome', 'photoshop', 'vs code'] },
      { evento: 'Reunião inventada', tarefa: 'x', pedido: 'x', apps: ['chrome'] }] }));
    if (sys.includes('MODO CODE (você está no modo Talk)')) return gtext(JSON.stringify(talkReply));
    return gtext('{}');
  }
  if (u.includes('googleapis.com/calendar/v3/users/me/calendarList')) return J({ items: [{ id: 'primary', summary: 'Eu', primary: true, selected: true }] });
  if (u.includes('googleapis.com/calendar/v3/calendars/')) return J({ items: [
    { id: 'e1', summary: 'Entrega do site da padaria', start: { date: today }, end: { date: tomorrow } },
    { id: 'e2', summary: 'Dentista', start: { date: today }, end: { date: tomorrow } }] });
  if (u.startsWith('https://news.google.com') || u.includes('open-meteo.com')) return new Response('x', { status: 503 });
  throw new Error('fetch inesperado: ' + u.slice(0, 80));
};
const L = await import('../lib/launcher.js');
const spawned = [];
L.OPEN.platform = 'win32'; L.OPEN.exists = () => false;
L.OPEN.spawn = (cmd, args) => { spawned.push([cmd, ...args].join(' ')); const c = new EventEmitter(); c.unref = () => {}; return c; };
const { server } = await import('../server.js');
const { saveProfile } = await import('../lib/profile.js');
saveProfile({ name: 'Teste', address: 'senhor', lang: 'pt-BR', news: false, city: { name: 'Jundiaí', latitude: -23.2, longitude: -46.9, timezone: tz } }, null);
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const call = async (p, body) => (await real(`http://localhost:${PORT}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body) })).json();

try {
  // "prepara" antes da saudação: nada separado ainda, cai na conversa normal (não abre nada).
  const g = await call('/api/greeting', {});
  const plan = g.brief.codePlan;
  assert.equal(plan.length, 1, 'só o compromisso real em que o Code ajuda');
  assert.equal(plan[0].evento, 'Entrega do site da padaria');
  assert.deepEqual(plan[0].apps.map(a => a.label), ['o VS Code', 'o Chrome'], 'só apps que o Jarvis sabe abrir, sem repetir');
  assert.match(g.codeText, /Para Entrega do site da padaria.*já separei: Criar o index\.html com o cardápio, com o VS Code e o Chrome\. Diga "prepara"/);
  // Botão "Preparar" e a voz "prepara": abrem os apps separados.
  let r = await call('/api/code/prepare', { i: 0 });
  assert.equal(r.ok, true); assert.deepEqual(r.opened, ['o VS Code', 'o Chrome']); assert.equal(spawned.length, 2);
  r = await call('/api/chat', { text: 'Jarvis, prepara tudo' });
  assert.match(r.intro, /abri o VS Code e o Chrome/); assert.equal(spawned.length, 4);
  // Talk: pedido que é trabalho do modo Code volta com sugerir_code (a interface mostra o botão).
  r = await call('/api/chat', { text: 'clica no primeiro vídeo do youtube pra mim', mode: 'talk' });
  assert.equal(r.sugerir_code, true); assert.match(r.intro, /modo Code/);
  talkReply = { ...talkReply, intro: 'Canberra, senhor.', sugerir_code: false };
  r = await call('/api/chat', { text: 'qual a capital da austrália', mode: 'talk' });
  assert.equal(r.sugerir_code, false);
  console.log('codeplan: saudação com tarefas, prepara e sugestão do modo Code ok');
} finally { server.close(); }
