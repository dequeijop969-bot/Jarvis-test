// Utilidades OAuth: state + PKCE (S256), tokens em data/tokens.local.json (600).
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readJSON, writeJSON } from './store.js';
import { registerSecret } from './secrets.js';

const FILE = 'tokens.local.json';
const pending = new Map(); // state -> { provider, verifier, exp }
const b64u = b => b.toString('base64url');
// Na web (site publicado) cada pessoa tem os próprios logins: os tokens vêm de um cookie cifrado do navegador dela
// (lib/webtokens.js), não do arquivo deste servidor. Quem atende o pedido da web abre esse contexto com webTokens.run.
export const webTokens = new AsyncLocalStorage();

export function startFlow(provider) {
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  const state = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const w = webTokens.getStore();
  if (w) w.flowSet(provider, state, verifier); else pending.set(state, { provider, verifier, exp: Date.now() + 10 * 60_000 });
  return { state, challenge };
}
export function finishFlow(provider, state) {
  const w = webTokens.getStore();
  if (w) { const f = w.flowGet(provider); return f && f.state === String(state || '') ? f.verifier : null; }
  const p = pending.get(String(state || ''));
  pending.delete(String(state || ''));
  if (!p || p.provider !== provider || p.exp < Date.now()) return null;
  return p.verifier;
}

export function getTokens(provider) {
  const w = webTokens.getStore();
  const t = (w ? w.tokens[provider] : readJSON(FILE, {})[provider]) || null;
  if (t) { registerSecret(t.access_token); registerSecret(t.refresh_token); }
  return t;
}
export function setTokens(provider, t) {
  const w = webTokens.getStore();
  if (w) { if (t) { w.tokens[provider] = t; registerSecret(t.access_token); registerSecret(t.refresh_token); } else delete w.tokens[provider]; w.save(provider); return; }
  const all = readJSON(FILE, {});
  if (t) { all[provider] = t; registerSecret(t.access_token); registerSecret(t.refresh_token); }
  else delete all[provider];
  writeJSON(FILE, all);
}
