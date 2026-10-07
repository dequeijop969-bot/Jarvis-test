// Senha de acesso do modo hospedado: cookie assinado (HMAC), sem estado no servidor (funciona em funções serverless).
import crypto from 'node:crypto';
import { PASSWORD } from './config.js';

const KEY = crypto.createHash('sha256').update('jarvis-session|' + PASSWORD).digest();
const DAYS = 7;
const sign = v => crypto.createHmac('sha256', KEY).update(v).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function checkPassword(input) {
  if (!PASSWORD) return false;
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(PASSWORD));
}
export const makeCookieValue = () => { const v = String(Date.now() + DAYS * 864e5); return `${v}.${sign(v)}`; };
export function validCookie(header) {
  const m = /(?:^|;\s*)jv=([^;]+)/.exec(header || '');
  if (!m || !PASSWORD) return false;
  const [v, sig] = m[1].split('.');
  return !!(v && sig && /^\d{10,15}$/.test(v) && same(sig, sign(v)) && Number(v) > Date.now());
}
export const cookieHeader = (value, secure) =>
  `jv=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? DAYS * 86400 : 0}${secure ? '; Secure' : ''}`;

// Freio simples contra tentativa de senha: 5 erros em 15 min por IP (por instância).
const fails = new Map();
export function blocked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (f.until < Date.now()) { fails.delete(ip); return false; }
  return f.n >= 5;
}
export function fail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  fails.set(ip, { n: f.n + 1, until: Date.now() + 15 * 60_000 });
  if (fails.size > 500) fails.delete(fails.keys().next().value);
}
export const ok = ip => fails.delete(ip);
