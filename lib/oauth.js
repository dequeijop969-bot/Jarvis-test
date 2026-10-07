// Utilidades OAuth: state + PKCE (S256), tokens em data/tokens.local.json (600).
import crypto from 'node:crypto';
import { readJSON, writeJSON } from './store.js';
import { registerSecret } from './secrets.js';
import { HOSTED, PASSWORD } from './config.js';

const FILE = 'tokens.local.json';
const pending = new Map(); // state -> { provider, verifier, exp }
const b64u = b => b.toString('base64url');

// Hospedado em função serverless, o callback pode cair noutra instância: o state carrega o verifier cifrado (AES-GCM), sem memória.
const stateless = HOSTED && !!PASSWORD;
const KEY = crypto.createHash('sha256').update('jarvis-oauth|' + PASSWORD).digest();
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}
function unseal(s) {
  try {
    const b = Buffer.from(String(s), 'base64url'); if (b.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}

export function startFlow(provider) {
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  const verifier = b64u(crypto.randomBytes(48)), exp = Date.now() + 10 * 60_000;
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = stateless ? seal({ provider, verifier, exp, n: b64u(crypto.randomBytes(8)) }) : b64u(crypto.randomBytes(24));
  if (!stateless) pending.set(state, { provider, verifier, exp });
  return { state, challenge };
}
export function finishFlow(provider, state) {
  const p = stateless ? unseal(state) : pending.get(String(state || ''));
  if (!stateless) pending.delete(String(state || ''));
  if (!p || p.provider !== provider || p.exp < Date.now()) return null;
  return p.verifier;
}

export function getTokens(provider) {
  const t = readJSON(FILE, {})[provider] || null;
  if (t) { registerSecret(t.access_token); registerSecret(t.refresh_token); }
  return t;
}
export function setTokens(provider, t) {
  const all = readJSON(FILE, {});
  if (t) { all[provider] = t; registerSecret(t.access_token); registerSecret(t.refresh_token); }
  else delete all[provider];
  writeJSON(FILE, all);
}
