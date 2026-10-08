// Login com GitHub: sessão criptografada, state do OAuth e recusa de cookie adulterado/expirado. Sem internet.
process.env.JARVIS_SESSION_SECRET = 'segredo-de-teste-'.repeat(3);
process.env.GITHUB_CLIENT_ID = 'cid'; process.env.GITHUB_CLIENT_SECRET = 'csec';
import assert from 'node:assert/strict';
const a = await import('../lib/auth.js');
const ck = c => c.split(';')[0];
const sess = { login: 'davi', name: 'Davi', gh: { access: 'tok123', refresh: null, exp: null } };
const c = ck(a.sessionCookie(sess, true)); const back = a.readSession(c);
assert.equal(back.login, 'davi'); assert.equal(back.gh.access, 'tok123');
assert.ok(!c.includes('tok123') && !c.includes('davi'), 'cookie não pode vazar o conteúdo');
assert.equal(a.readSession(c.slice(0, -3) + 'AAA'), null, 'cookie adulterado deve ser recusado');
assert.equal(a.readSession('jv=' + a.seal({ login: 'x', exp: Date.now() - 1000 })), null, 'expirado deve ser recusado');
assert.equal(a.readSession(''), null);
const st = a.newState(true); assert.ok(a.checkState(ck(st.cookie).replace('jvs=', 'jvs='), st.state));
assert.equal(a.checkState(ck(st.cookie), 'outro-state-qualquer-aqui-0000000000'), false, 'state errado deve falhar');
assert.equal(a.checkState('', st.state), false);
assert.ok(a.githubAuthUrl('abc').startsWith('https://github.com/login/oauth/authorize?') && a.githubAuthUrl('abc').includes('state=abc') && a.githubAuthUrl('abc').includes('allow_signup=false'));
assert.ok(!('checkPassword' in a), 'a senha foi removida');
console.log('auth: ok');
