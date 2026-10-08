// Hospedado: tokens do Google ficam no cookie de sessão (não em /tmp) e sobrevivem a uma "instância nova". Sem internet.
process.env.JARVIS_PUBLIC_URL = 'https://exemplo.vercel.app';
process.env.JARVIS_SESSION_SECRET = 'segredo-de-teste-'.repeat(3);
process.env.JARVIS_DATA_DIR = '/tmp/jarvis-test-hosted-' + process.pid;
import assert from 'node:assert/strict';
import fs from 'node:fs';
const auth = await import('../lib/auth.js'), session = await import('../lib/session.js'), oauth = await import('../lib/oauth.js');
const sess = { login: 'davi', name: 'Davi', gh: { access: 'g1', refresh: null, exp: null } };
session.runWith(sess, () => oauth.setTokens('google', { access_token: 'AAA', refresh_token: 'RRR', scope: 'x y', expires_at: 1 }));
assert.equal(sess._dirty, true);
assert.ok(!fs.existsSync(process.env.JARVIS_DATA_DIR + '/tokens.local.json'), 'hospedado não pode gravar token em disco');
const { _dirty, ...rest } = sess; const cookie = auth.sessionCookie(rest, true).split(';')[0];
assert.ok(!cookie.includes('RRR') && !cookie.includes('AAA'), 'cookie não pode vazar o token');
const novo = auth.readSession(cookie); // "outra instância" lendo só o cookie
assert.equal(session.runWith(novo, () => oauth.getTokens('google').refresh_token), 'RRR');
session.runWith(novo, () => oauth.setTokens('google', null));
assert.equal(session.runWith(novo, () => oauth.getTokens('google')), null);
assert.ok(cookie.length < 3800, 'cookie cabe no limite do navegador (' + cookie.length + ')');
console.log('hostedtokens: ok');
