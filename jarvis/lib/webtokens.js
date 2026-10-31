// Logins da web (Google e Spotify) guardados no navegador de cada pessoa: cookie HttpOnly cifrado (AES-256-GCM), com a chave
// derivada de JARVIS_SESSION_SECRET e preso à conta (o cookie de uma pessoa não serve para outra). O servidor não grava nada.
import crypto from 'node:crypto';

const PROVIDERS = ['google', 'spotify'];
const DAYS = 180;
const key = () => crypto.createHash('sha256').update('jarvis-web-tokens:' + (process.env.JARVIS_SESSION_SECRET || '')).digest();

export function seal(o) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
export function open(s) {
  try {
    const b = Buffer.from(String(s || ''), 'base64url'); if (b.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/)
  .map(x => { const i = x.indexOf('='); return i > 0 ? [x.slice(0, i), x.slice(i + 1)] : null; }).filter(Boolean));
// Junta ao que já ia no Set-Cookie (redirect/send usam writeHead, que mantém o que foi posto com setHeader).
function addCookie(res, c) {
  if (res.headersSent) return;
  const cur = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(cur) ? cur : cur ? [cur] : []), c]);
}
const attrs = (path, age) => `; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

// Contexto de um pedido da web: lib/oauth.js lê e grava os tokens aqui em vez do arquivo do servidor.
export function webTokenCtx(req, res, who) {
  const ck = cookies(req), tokens = {};
  for (const p of PROVIDERS) { const o = open(ck['jv_' + p]); if (o && o.uid === who.id && o.t) tokens[p] = o.t; }
  return {
    tokens,
    save(p) { const t = tokens[p]; addCookie(res, `jv_${p}=${t ? seal({ uid: who.id, t }) : ''}${attrs('/', t ? DAYS * 86400 : 0)}`); },
    flowSet(p, state, verifier) { addCookie(res, `jv_f_${p}=${seal({ uid: who.id, state, verifier, exp: Date.now() + 600_000 })}${attrs('/auth', 600)}`); },
    flowGet(p) {
      const o = open(ck['jv_f_' + p]); addCookie(res, `jv_f_${p}=${attrs('/auth', 0)}`);
      return o && o.uid === who.id && o.exp > Date.now() ? o : null;
    }
  };
}
